import { Router } from "express";
import { db, exitReasonsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { eq } from "drizzle-orm";
import { auditLog } from "../middlewares/audit";

const router = Router();

// GET /api/exit-reasons
router.get("/", requireAuth, async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "true" && res.locals.user?.role === "admin";
    const reasons = await db.query.exitReasonsTable.findMany({
      where: includeInactive ? undefined : eq(exitReasonsTable.isActive, true),
      orderBy: (r, { asc }) => [asc(r.name)],
    });
    res.json(reasons);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/exit-reasons
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) { res.status(400).json({ error: "اسم سبب الإخراج مطلوب" }); return; }
    const [reason] = await db
      .insert(exitReasonsTable)
      .values({ name: name.trim(), isSystem: false, isActive: true })
      .returning();
    await auditLog({
      req,
      action: "create",
      entityType: "exit_reason",
      entityId: reason.id,
      details: { name: reason.name },
    });
    res.status(201).json(reason);
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "السبب مستخدم مسبقاً" }); return; }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/exit-reasons/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name } = req.body as { name?: string };
    if (isNaN(id)) { res.status(400).json({ error: "معرّف السبب غير صالح" }); return; }
    if (!name?.trim()) { res.status(400).json({ error: "اسم سبب الإخراج مطلوب" }); return; }
    const current = await db.query.exitReasonsTable.findFirst({ where: eq(exitReasonsTable.id, id) });
    if (!current) { res.status(404).json({ error: "سبب الإخراج غير موجود" }); return; }
    if (current.isSystem) {
      res.status(400).json({ error: "لا يمكن تعديل الأسباب الافتراضية للنظام" });
      return;
    }
    const [updated] = await db
      .update(exitReasonsTable)
      .set({ name: name.trim() })
      .where(eq(exitReasonsTable.id, id))
      .returning();
    await auditLog({
      req,
      action: "update",
      entityType: "exit_reason",
      entityId: updated.id,
      details: { name: updated.name },
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "سبب الإخراج مستخدم مسبقاً" }); return; }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/exit-reasons/:id/toggle
router.patch("/:id/toggle", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "معرّف السبب غير صالح" }); return; }
    const current = await db.query.exitReasonsTable.findFirst({ where: eq(exitReasonsTable.id, id) });
    if (!current) { res.status(404).json({ error: "سبب الإخراج غير موجود" }); return; }
    if (current.isSystem) { res.status(400).json({ error: "لا يمكن تعطيل الأسباب الافتراضية للنظام" }); return; }
    const [updated] = await db
      .update(exitReasonsTable)
      .set({ isActive: !current.isActive })
      .where(eq(exitReasonsTable.id, id))
      .returning();
    await auditLog({
      req,
      action: "update",
      entityType: "exit_reason",
      entityId: updated.id,
      details: { name: updated.name, isActive: updated.isActive },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
