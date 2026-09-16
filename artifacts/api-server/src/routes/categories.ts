import { Router } from "express";
import { db } from "@workspace/db";
import { categoriesTable, itemsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import {
  ensureEntityIdentity,
  ensureNodeIdentity,
  recordLocalChange,
} from "../lib/sync-service";

const router = Router();

// GET /api/categories
router.get("/", requireAuth, async (_req, res) => {
  try {
    const categories = await db.query.categoriesTable.findMany({
      orderBy: (c, { asc }) => [asc(c.name)],
    });
    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/categories
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, type } = req.body as { name?: string; type?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ error: "اسم التصنيف مطلوب" });
      return;
    }
    if (!type || !["consumable", "equipment"].includes(type)) {
      res.status(400).json({ error: "نوع التصنيف مطلوب (consumable أو equipment)" });
      return;
    }
    const node = await ensureNodeIdentity("web");
    const created = await db.transaction(async (tx) => {
      const [category] = await tx
        .insert(categoriesTable)
        .values({ name: name.trim(), type: type as "consumable" | "equipment" })
        .returning();
      const globalId = await ensureEntityIdentity(tx, "category", category.id);
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: "category",
        localEntityId: category.id,
        globalId,
        changeType: "create",
        payload: { id: category.id, name: category.name, type: category.type, createdAt: category.createdAt },
      });
      return category;
    });
    await auditLog({
      req,
      action: "create",
      entityType: "category",
      entityId: created.id,
      details: { name: created.name, type: created.type },
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "هذا التصنيف موجود مسبقاً" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// PUT /api/categories/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "معرّف التصنيف غير صالح." }); return; }
    const { name, type } = req.body as { name?: string; type?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ error: "اسم التصنيف مطلوب" });
      return;
    }
    const updateData: Partial<typeof categoriesTable.$inferInsert> = { name: name.trim() };
    if (type && ["consumable", "equipment"].includes(type)) {
      updateData.type = type as "consumable" | "equipment";
    }
    const node = await ensureNodeIdentity("web");
    const updated = await db.transaction(async (tx) => {
      const [category] = await tx
        .update(categoriesTable)
        .set(updateData)
        .where(eq(categoriesTable.id, id))
        .returning();
      if (!category) return undefined;
      const globalId = await ensureEntityIdentity(tx, "category", category.id);
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: "category",
        localEntityId: category.id,
        globalId,
        changeType: "update",
        payload: { id: category.id, name: category.name, type: category.type, createdAt: category.createdAt },
      });
      return category;
    });
    if (!updated) {
      res.status(404).json({ error: "التصنيف غير موجود" });
      return;
    }
    await auditLog({
      req,
      action: "update",
      entityType: "category",
      entityId: updated.id,
      details: { name: updated.name, type: updated.type },
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "هذا التصنيف موجود مسبقاً" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// DELETE /api/categories/:id
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "معرّف التصنيف غير صالح." }); return; }
    // Phase 1 governance: a category used by any item must not disappear.
    const [inUse] = await db
      .select({ id: itemsTable.id })
      .from(itemsTable)
      .where(eq(itemsTable.categoryId, id))
      .limit(1);
    if (inUse) {
      res.status(409).json({
        error: "لا يمكن حذف تصنيف مستخدَم في أصناف. انقل الأصناف إلى تصنيف آخر أو أرشِفها أولًا.",
        code: "CATEGORY_IN_USE",
      });
      return;
    }
    const node = await ensureNodeIdentity("web");
    const deleted = await db.transaction(async (tx) => {
      const [category] = await tx
        .delete(categoriesTable)
        .where(eq(categoriesTable.id, id))
        .returning();
      if (!category) return undefined;
      const globalId = await ensureEntityIdentity(tx, "category", category.id);
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: "category",
        localEntityId: category.id,
        globalId,
        changeType: "delete",
        payload: { id: category.id, name: category.name, type: category.type, createdAt: category.createdAt },
      });
      return category;
    });
    if (!deleted) {
      res.status(404).json({ error: "التصنيف غير موجود" });
      return;
    }
    await auditLog({
      req,
      action: "delete",
      entityType: "category",
      entityId: deleted.id,
      details: { name: deleted.name },
    });
    res.json({ success: true });
  } catch (err: any) {
    // FK violation — category is in use
    if (err?.code === "23503") {
      res.status(409).json({ error: "لا يمكن حذف التصنيف لأنه مرتبط بمواد موجودة" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

export default router;
