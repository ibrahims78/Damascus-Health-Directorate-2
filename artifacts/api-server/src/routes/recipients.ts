import { Router } from "express";
import { db, recipientsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { eq } from "drizzle-orm";
import { auditLog } from "../middlewares/audit";

const router = Router();

// GET /api/recipients
router.get("/", requireAuth, async (_req, res) => {
  try {
    const includeInactive = _req.query.includeInactive === "true" && res.locals.user?.role === "admin";
    const recipients = await db.query.recipientsTable.findMany({
      where: includeInactive ? undefined : eq(recipientsTable.isActive, true),
      orderBy: (r, { asc }) => [asc(r.name)],
    });
    res.json(recipients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/recipients (master data - admin only, phase 1 governance)
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, notes } = req.body as { name?: string; notes?: string | null };
    if (!name?.trim()) {
      res.status(400).json({ error: "اسم الجهة مطلوب" });
      return;
    }
    const [recipient] = await db
      .insert(recipientsTable)
      .values({ name: name.trim(), notes: notes?.trim() || null })
      .returning();
    await auditLog({
      req,
      action: "create",
      entityType: "recipient",
      entityId: recipient.id,
      details: { name: recipient.name },
    });
    res.status(201).json(recipient);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "اسم الجهة مستخدم مسبقاً" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/recipients/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, notes } = req.body as { name?: string; notes?: string | null };
    if (isNaN(id)) { res.status(400).json({ error: "معرّف الجهة غير صالح" }); return; }
    if (!name?.trim()) { res.status(400).json({ error: "اسم الجهة مطلوب" }); return; }
    const [updated] = await db
      .update(recipientsTable)
      .set({ name: name.trim(), notes: notes?.trim() || null })
      .where(eq(recipientsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "الجهة غير موجودة" }); return; }
    await auditLog({
      req,
      action: "update",
      entityType: "recipient",
      entityId: updated.id,
      details: { name: updated.name },
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "اسم الجهة مستخدم مسبقاً" }); return; }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/recipients/:id/toggle
router.patch("/:id/toggle", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "معرّف الجهة غير صالح" }); return; }
    const current = await db.query.recipientsTable.findFirst({ where: eq(recipientsTable.id, id) });
    if (!current) { res.status(404).json({ error: "الجهة غير موجودة" }); return; }
    const [updated] = await db
      .update(recipientsTable)
      .set({ isActive: !current.isActive })
      .where(eq(recipientsTable.id, id))
      .returning();
    await auditLog({
      req,
      action: "update",
      entityType: "recipient",
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
