import { Router } from "express";
import { db, warehousesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import {
  getCurrentWarehouse,
  listWarehouses,
  nextDocumentNumber,
  setCurrentWarehouse,
} from "../lib/warehouse-service";

/**
 * Phase 5 - warehouses of the multi-site model.
 * Reads are open to authenticated users; every write is admin-only.
 */
const router = Router();

// GET /api/warehouses
router.get("/", requireAuth, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.role === "admin";
    const includeArchived = isAdmin && String(req.query.includeArchived ?? "") === "1";
    res.json(await listWarehouses(includeArchived));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// GET /api/warehouses/current
router.get("/current", requireAuth, async (_req, res) => {
  try {
    res.json((await getCurrentWarehouse()) ?? null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// GET /api/warehouses/next-document-number?type=in
router.get("/next-document-number", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const type = String(req.query.type ?? "").trim();
    if (!type) {
      res.status(400).json({ error: "type مطلوب (مثال: in)." });
      return;
    }
    const DOC_TYPES: Record<string, string> = {
      IN: "IN",
      OUT: "OUT",
      CUSTODY_OUT: "CUST",
      CUSTODY_RETURN: "CUST-RET",
      DAMAGE: "DMG",
      CENTRAL_RETURN: "RET",
      ADJUST: "ADJ",
    };
    const normalized = type.toUpperCase().replace(/\s+/g, "_");
    const docType = DOC_TYPES[normalized] ?? normalized;
    const number = await nextDocumentNumber(docType);
    res.json({ documentNumber: number });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/warehouses/current  { id }
router.post("/current", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.body?.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف المستودع غير صالح." });
      return;
    }
    const wh = await setCurrentWarehouse(id);
    await auditLog({ req, action: "set_current_warehouse", entityType: "warehouse", entityId: id, details: { code: wh.code } });
    res.json(wh);
  } catch (err) {
    const message = err instanceof Error ? err.message : "خطأ";
    if (message === "WAREHOUSE_NOT_FOUND") {
      res.status(404).json({ error: "المستودع غير موجود." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/warehouses
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const code = String(req.body?.code ?? "").trim().toUpperCase();
    const name = String(req.body?.name ?? "").trim();
    const type = String(req.body?.type ?? "branch").trim() === "central" ? "central" : "branch";
    if (!code || !name) {
      res.status(400).json({ error: "الرمز والاسم مطلوبان." });
      return;
    }
    const [existing] = await db
      .select({ id: warehousesTable.id })
      .from(warehousesTable)
      .where(eq(warehousesTable.code, code))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "رمز المستودع مستخدم مسبقًا.", code: "WAREHOUSE_CODE_DUPLICATE" });
      return;
    }
    const [created] = await db
      .insert(warehousesTable)
      .values({ code, name, type, notes: req.body?.notes ? String(req.body.notes).trim() : null })
      .returning();
    await auditLog({ req, action: "create", entityType: "warehouse", entityId: created.id, details: { code, name } });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// PUT /api/warehouses/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف المستودع غير صالح." });
      return;
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) { res.status(400).json({ error: "الاسم مطلوب." }); return; }
      updates.name = name;
    }
    if (req.body?.notes !== undefined) {
      updates.notes = req.body.notes ? String(req.body.notes).trim() : null;
    }
    if (req.body?.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);
    if (req.body?.type !== undefined) updates.type = String(req.body.type) === "central" ? "central" : "branch";
    const [updated] = await db
      .update(warehousesTable)
      .set(updates as never)
      .where(eq(warehousesTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "المستودع غير موجود." });
      return;
    }
    await auditLog({ req, action: "update", entityType: "warehouse", entityId: id, details: { code: updated.code } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

export default router;
