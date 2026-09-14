import { Router } from "express";
import { db, unitsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import {
  countItemsUsingUnit,
  listUnits,
  normalizeUnit,
  seedDefaultUnits,
  unitUsage,
} from "../lib/units-service";

/**
 * Phase 2 - standard units of measure.
 * Reads are open to authenticated users; every write is admin-only.
 */
const router = Router();

// GET /api/units
router.get("/", requireAuth, async (req, res) => {
  try {
    const isAdmin = res.locals.user?.role === "admin";
    const includeArchived = isAdmin && String(req.query.includeArchived ?? "") === "1";
    res.json(await listUnits(includeArchived));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/units/usage - free-text units in use vs known units
router.get("/usage", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    res.json(await unitUsage());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/units/seed-defaults
router.post("/seed-defaults", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const created = await seedDefaultUnits();
    await auditLog({ req, action: "seed_defaults", entityType: "unit", details: { created } });
    res.json({ created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/units/normalize - unify a free-text unit into a standard unit
router.post("/normalize", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const from = String(req.body?.from ?? "").trim();
    const to = String(req.body?.to ?? "").trim();
    if (!from || !to) {
      res.status(400).json({ error: "from و to مطلوبان." });
      return;
    }
    if (from === to) {
      res.status(400).json({ error: "الوحدة المصدر والهدف متطابقتان." });
      return;
    }
    const updated = await normalizeUnit(from, to);
    await auditLog({
      req,
      action: "normalize_unit",
      entityType: "unit",
      details: { from, to, updated },
    });
    res.json({ updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/units
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const symbol = req.body?.symbol ? String(req.body.symbol).trim() : null;
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0;
    if (!name) {
      res.status(400).json({ error: "اسم الوحدة مطلوب." });
      return;
    }
    const [existing] = await db
      .select({ id: unitsTable.id })
      .from(unitsTable)
      .where(eq(unitsTable.name, name))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "اسم الوحدة مستخدم مسبقًا.", code: "UNIT_NAME_DUPLICATE" });
      return;
    }
    const [created] = await db
      .insert(unitsTable)
      .values({ name, symbol, sortOrder })
      .returning();
    await auditLog({ req, action: "create", entityType: "unit", entityId: created.id, details: { name } });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "اسم الوحدة مستخدم مسبقًا.", code: "UNIT_NAME_DUPLICATE" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/units/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الوحدة غير صالح." });
      return;
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        res.status(400).json({ error: "اسم الوحدة مطلوب." });
        return;
      }
      updates.name = name;
    }
    if (req.body?.symbol !== undefined) {
      updates.symbol = req.body.symbol ? String(req.body.symbol).trim() : null;
    }
    if (req.body?.sortOrder !== undefined && Number.isFinite(Number(req.body.sortOrder))) {
      updates.sortOrder = Number(req.body.sortOrder);
    }
    if (req.body?.isActive !== undefined) {
      updates.isActive = Boolean(req.body.isActive);
    }
    if (typeof updates.name === "string") {
      const [existing] = await db
        .select({ id: unitsTable.id })
        .from(unitsTable)
        .where(eq(unitsTable.name, updates.name as string))
        .limit(1);
      if (existing && existing.id !== id) {
        res.status(409).json({ error: "اسم الوحدة مستخدم مسبقًا.", code: "UNIT_NAME_DUPLICATE" });
        return;
      }
    }
    const [updated] = await db
      .update(unitsTable)
      .set(updates as never)
      .where(eq(unitsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "الوحدة غير موجودة." });
      return;
    }
    await auditLog({ req, action: "update", entityType: "unit", entityId: id, details: { name: updated.name } });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "اسم الوحدة مستخدم مسبقًا.", code: "UNIT_NAME_DUPLICATE" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/units/:id - archive; refuse while items still use the unit
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الوحدة غير صالح." });
      return;
    }
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, id)).limit(1);
    if (!unit) {
      res.status(404).json({ error: "الوحدة غير موجودة." });
      return;
    }
    const inUse = await countItemsUsingUnit(unit.name);
    if (inUse > 0) {
      res.status(409).json({
        error: `لا يمكن أرشفة وحدة مستخدمة في ${inUse} صنف. وحّد الأصناف إلى وحدة أخرى أولًا.`,
        code: "UNIT_IN_USE",
        items: inUse,
      });
      return;
    }
    const [archived] = await db
      .update(unitsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(unitsTable.id, id))
      .returning();
    await auditLog({ req, action: "archive", entityType: "unit", entityId: id, details: { name: unit.name } });
    res.json(archived);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
