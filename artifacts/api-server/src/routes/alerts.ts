import { Router } from "express";
import { db, alertsTable, alertReadsTable, itemsTable, equipmentTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { eq, and, desc, inArray, sql, notInArray } from "drizzle-orm";
import { addSSEClient, broadcastAlertUpdate } from "../lib/sse-manager";
import { runAlertWorker } from "../lib/alert-worker";

const router = Router();

// ─── GET /api/alerts ──────────────────────────────────────────────────────────
// Returns all unresolved alerts, annotated with isRead for the current user.
// Ordered: critical first, then by most-recently updated.
router.get("/", requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.user.id as number;

    const alerts = await db
      .select({
        id: alertsTable.id,
        type: alertsTable.type,
        entityId: alertsTable.entityId,
        entityType: alertsTable.entityType,
        severity: alertsTable.severity,
        message: alertsTable.message,
        createdAt: alertsTable.createdAt,
        updatedAt: alertsTable.updatedAt,
        isRead: sql<boolean>`EXISTS (
          SELECT 1 FROM alert_reads ar
          WHERE ar.alert_id = ${alertsTable.id}
            AND ar.user_id = ${userId}
        )`.as("is_read"),
      })
      .from(alertsTable)
      .where(eq(alertsTable.isResolved, false))
      .orderBy(
        sql`CASE ${alertsTable.severity}
              WHEN 'critical' THEN 0
              WHEN 'warning'  THEN 1
              ELSE 2
            END`,
        desc(alertsTable.updatedAt)
      );

    // Fetch entity names in one round-trip each
    const itemIds = alerts.filter(a => a.entityType === "item").map(a => a.entityId);
    const equipIds = alerts.filter(a => a.entityType === "equipment").map(a => a.entityId);

    const [itemNames, equipNames] = await Promise.all([
      itemIds.length > 0
        ? db.select({ id: itemsTable.id, name: itemsTable.name }).from(itemsTable).where(inArray(itemsTable.id, itemIds))
        : [],
      equipIds.length > 0
        ? db.select({ id: equipmentTable.id, name: equipmentTable.name }).from(equipmentTable).where(inArray(equipmentTable.id, equipIds))
        : [],
    ]);

    const itemNameMap = new Map(itemNames.map(i => [i.id, i.name]));
    const equipNameMap = new Map(equipNames.map(e => [e.id, e.name]));

    const response = alerts.map(a => ({
      // Backward-compat string id (used by legacy code)
      id: `${a.type}-${a.entityId}`,
      // New numeric db id for operations
      dbId: a.id,
      type: a.type,
      message: a.message,
      severity: a.severity,
      entityId: a.entityId,
      entityType: a.entityType,
      entityName:
        a.entityType === "item"
          ? (itemNameMap.get(a.entityId) ?? null)
          : (equipNameMap.get(a.entityId) ?? null),
      isRead: Boolean(a.isRead),
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      // Legacy fields kept for any existing consumers
      itemId: a.entityType === "item" ? a.entityId : null,
      itemName:
        a.entityType === "item" ? (itemNameMap.get(a.entityId) ?? null) : null,
    }));

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/alerts/stream ───────────────────────────────────────────────────
// SSE endpoint — client connects once and receives a push whenever alerts change.
// The browser's EventSource auto-reconnects on drop.
router.get("/stream", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx/proxy buffering
  res.flushHeaders();

  // Send an initial ping so the client knows the connection is alive
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const userId = res.locals.user.id as number;
  const cleanup = addSSEClient(userId, res);

  // Keep-alive comment every 25 s (prevents proxy timeouts)
  const keepAlive = setInterval(() => {
    try { res.write(": ka\n\n"); } catch { cleanup(); clearInterval(keepAlive); }
  }, 25_000);

  req.on("close", () => {
    cleanup();
    clearInterval(keepAlive);
  });
});

// ─── POST /api/alerts/read-all ────────────────────────────────────────────────
// Mark every unresolved alert as read for the current user.
router.post("/read-all", requireAuth, async (_req, res) => {
  try {
    const userId = res.locals.user.id as number;

    const unresolved = await db
      .select({ id: alertsTable.id })
      .from(alertsTable)
      .where(eq(alertsTable.isResolved, false));

    if (unresolved.length > 0) {
      await db
        .insert(alertReadsTable)
        .values(unresolved.map(a => ({ alertId: a.id, userId })))
        .onConflictDoUpdate({
          target: [alertReadsTable.alertId, alertReadsTable.userId],
          set: { readAt: new Date() },
        });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/alerts/:id/read ────────────────────────────────────────────────
// Mark a single alert as read for the current user.
router.post("/:id/read", requireAuth, async (req, res) => {
  try {
    const userId = res.locals.user.id as number;
    const alertId = parseInt(String(req.params.id), 10);
    if (isNaN(alertId)) { res.status(400).json({ error: "Invalid alert id" }); return; }

    await db
      .insert(alertReadsTable)
      .values({ alertId, userId })
      .onConflictDoUpdate({
        target: [alertReadsTable.alertId, alertReadsTable.userId],
        set: { readAt: new Date() },
      });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/alerts/:id/resolve ────────────────────────────────────────────
// Manually resolve an alert (admin or warehouse_manager only).
// The worker will not re-open it unless the entity's condition changes again.
router.post("/:id/resolve", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const userId = res.locals.user.id as number;
    const alertId = parseInt(String(req.params.id), 10);
    if (isNaN(alertId)) { res.status(400).json({ error: "Invalid alert id" }); return; }

    const [updated] = await db
      .update(alertsTable)
      .set({ isResolved: true, resolvedAt: new Date(), resolvedBy: userId })
      .where(and(eq(alertsTable.id, alertId), eq(alertsTable.isResolved, false)))
      .returning({ id: alertsTable.id });

    if (!updated) {
      res.status(404).json({ error: "Alert not found or already resolved" });
      return;
    }

    broadcastAlertUpdate();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/alerts/refresh ────────────────────────────────────────────────
// Trigger an immediate worker run (admin/warehouse_manager use).
router.post("/refresh", requireAuth, requireRole("admin", "warehouse_manager"), (_req, res) => {
  runAlertWorker().catch((err) => console.error("Alert worker error:", err));
  res.json({ ok: true, message: "Worker triggered" });
});

export default router;
