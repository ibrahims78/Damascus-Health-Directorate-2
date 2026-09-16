import { Router, type Response } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { binsTable, db, itemsTable, warehousesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import { getCurrentWarehouse } from "../lib/warehouse-service";

/**
 * P1-6 - structured storage locations (bins).
 * Reads are open to authenticated users; writes are admin-only. A bin is never
 * deleted once items point at its code - it is archived instead.
 */
const router = Router();

class BinError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

function binFailure(res: Response, error: unknown) {
  if (error instanceof BinError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
}

// GET /api/bins
router.get("/", requireAuth, async (req, res) => {
  try {
    const includeArchived = String(req.query.includeArchived ?? "") === "1" && res.locals.user?.role === "admin";
    const rows = await db
      .select({
        id: binsTable.id,
        code: binsTable.code,
        name: binsTable.name,
        warehouseId: binsTable.warehouseId,
        zone: binsTable.zone,
        notes: binsTable.notes,
        isActive: binsTable.isActive,
        warehouseCode: warehousesTable.code,
        warehouseName: warehousesTable.name,
      })
      .from(binsTable)
      .leftJoin(warehousesTable, eq(binsTable.warehouseId, warehousesTable.id))
      .where(includeArchived ? sql`true` : eq(binsTable.isActive, true))
      .orderBy(asc(binsTable.code));
    res.json(rows);
  } catch (error) {
    binFailure(res, error);
  }
});

// GET /api/bins/usage - how many items sit in each bin
router.get("/usage", requireAuth, async (_req, res) => {
  try {
    const rows = await db
      .select({ binCode: itemsTable.binCode, items: sql<number>`count(*)` })
      .from(itemsTable)
      .where(eq(itemsTable.isActive, true))
      .groupBy(itemsTable.binCode);
    const catalog = await db.select({ code: binsTable.code }).from(binsTable).where(eq(binsTable.isActive, true));
    const known = new Set(catalog.map((row) => row.code));
    res.json(
      rows
        .filter((row) => row.binCode)
        .map((row) => ({ binCode: row.binCode, items: Number(row.items ?? 0), known: known.has(String(row.binCode)) }))
        .sort((a, b) => Number(a.known) - Number(b.known) || String(a.binCode).localeCompare(String(b.binCode))),
    );
  } catch (error) {
    binFailure(res, error);
  }
});

// POST /api/bins
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const code = String(req.body?.code ?? "").trim().toUpperCase();
    const name = String(req.body?.name ?? "").trim();
    if (!code || !name) throw new BinError("BIN_FIELDS_REQUIRED", "رمز الموقع واسمه مطلوبان.");
    const [existing] = await db.select({ id: binsTable.id }).from(binsTable).where(eq(binsTable.code, code)).limit(1);
    if (existing) throw new BinError("BIN_CODE_DUPLICATE", "رمز الموقع مسجّل مسبقًا.", 409);
    const current = await getCurrentWarehouse();
    const warehouseId = Number(req.body?.warehouseId ?? current?.id ?? 0);
    if (!Number.isSafeInteger(warehouseId) || warehouseId <= 0) {
      throw new BinError("BIN_WAREHOUSE_REQUIRED", "المستودع مطلوب.", 400);
    }
    const [created] = await db
      .insert(binsTable)
      .values({
        code,
        name,
        warehouseId,
        zone: req.body?.zone ? String(req.body.zone).trim().toUpperCase() : null,
        notes: req.body?.notes ? String(req.body.notes).trim() : null,
      })
      .returning();
    await auditLog({ req, action: "create", entityType: "bin", entityId: created.id, details: { code, warehouseId } });
    res.status(201).json(created);
  } catch (error) {
    binFailure(res, error);
  }
});

// PUT /api/bins/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) throw new BinError("BIN_ID_INVALID", "معرّف الموقع غير صالح.");
    const [bin] = await db.select().from(binsTable).where(eq(binsTable.id, id)).limit(1);
    if (!bin) throw new BinError("BIN_NOT_FOUND", "الموقع غير موجود.", 404);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) throw new BinError("BIN_NAME_REQUIRED", "اسم الموقع مطلوب.");
      updates.name = name;
    }
    if (req.body?.zone !== undefined) updates.zone = req.body.zone ? String(req.body.zone).trim().toUpperCase() : null;
    if (req.body?.notes !== undefined) updates.notes = req.body.notes ? String(req.body.notes).trim() : null;
    if (req.body?.isActive !== undefined) updates.isActive = Boolean(req.body.isActive);
    const [updated] = await db.update(binsTable).set(updates as never).where(eq(binsTable.id, id)).returning();
    await auditLog({ req, action: "update", entityType: "bin", entityId: id, details: { code: bin.code } });
    res.json(updated);
  } catch (error) {
    binFailure(res, error);
  }
});

// DELETE /api/bins/:id - archive; refuse while items still point at the code
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) throw new BinError("BIN_ID_INVALID", "معرّف الموقع غير صالح.");
    const [bin] = await db.select().from(binsTable).where(eq(binsTable.id, id)).limit(1);
    if (!bin) throw new BinError("BIN_NOT_FOUND", "الموقع غير موجود.", 404);
    const [inUse] = await db
      .select({ count: sql<number>`count(*)` })
      .from(itemsTable)
      .where(eq(itemsTable.binCode, bin.code));
    const used = Number(inUse?.count ?? 0);
    if (used > 0) {
      throw new BinError(
        "BIN_IN_USE",
        `لا يمكن أرشفة موقع مستخدم في ${used} صنف. أعد توزيع الأصناف أولًا.`,
        409,
      );
    }
    const [archived] = await db
      .update(binsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(binsTable.id, id))
      .returning();
    await auditLog({ req, action: "archive", entityType: "bin", entityId: id, details: { code: bin.code } });
    res.json(archived);
  } catch (error) {
    binFailure(res, error);
  }
});

export default router;
