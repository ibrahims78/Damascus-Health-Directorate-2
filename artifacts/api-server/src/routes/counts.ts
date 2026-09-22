import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import {
  CountError,
  approveCountSession,
  cancelCountSession,
  createCountSession,
  getCountSession,
  listCountSessions,
  recordCountEntries,
} from "../lib/counts-service";
import { movementContextFromRequest } from "../lib/inventory-movement-service";
import { resolveScopedWarehouse, scopedWarehouseId, withinScope } from "../lib/scope";
import { getCurrentWarehouse } from "../lib/warehouse-service";

/**
 * P0 - cycle counting endpoints.
 * Counting is done by warehouse staff; approval (which posts the differences)
 * is admin-only, and every session is audited.
 */
const router = Router();

function countFailure(res: import("express").Response, error: unknown) {
  if (error instanceof CountError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  const status = (error as { status?: unknown } | null)?.status;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof status === "number" && status >= 400 && status < 600) {
    res.status(status).json({
      error: error instanceof Error ? error.message : "تعذّر إكمال العملية.",
      ...(typeof code === "string" ? { code } : {}),
    });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
}

// GET /api/counts
router.get("/", requireAuth, async (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit ?? "100"), 10);
    const scope = scopedWarehouseId(res.locals.user);
    const rows = await listCountSessions(Number.isFinite(limit) ? limit : 100);
    res.json(scope === null ? rows : rows.filter((row) => withinScope(res.locals.user, row.warehouseId)));
  } catch (error) {
    countFailure(res, error);
  }
});

// GET /api/counts/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الجلسة غير صالح." });
      return;
    }
    res.json(await getCountSession(id));
  } catch (error) {
    countFailure(res, error);
  }
});

// POST /api/counts  { scope?, categoryId?, blindCount?, notes? }
router.post("/", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const current = await getCurrentWarehouse();
    if (!current) {
      res.status(409).json({ error: "لا يوجد مستودع حالي معرّف.", code: "NO_WAREHOUSE" });
      return;
    }
    const requestedWarehouseId = Number(req.body?.warehouseId ?? current.id);
    const session = await createCountSession({
      // replaced below by the scoped warehouse
      warehouseId: resolveScopedWarehouse(res.locals.user, requestedWarehouseId, current.id),
      scope: req.body?.scope ? String(req.body.scope) : "full",
      categoryId: req.body?.categoryId ? Number(req.body.categoryId) : null,
      blindCount: req.body?.blindCount === undefined ? true : Boolean(req.body.blindCount),
      notes: req.body?.notes ? String(req.body.notes).trim() : null,
      userId: res.locals.user?.id ?? null,
      userName: res.locals.user?.fullName ?? null,
    });
    await auditLog({
      req,
      action: "create",
      entityType: "count_session",
      entityId: session.id,
      details: { code: session.code, lines: session.linesCount },
    });
    res.status(201).json(await getCountSession(session.id));
  } catch (error) {
    countFailure(res, error);
  }
});

// POST /api/counts/:id/entries  { entries: [{ lineId, countedQuantity, varianceReason? }] }
router.post("/:id/entries", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الجلسة غير صالح." });
      return;
    }
    const rawEntries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (rawEntries.length === 0) {
      res.status(400).json({ error: "لا توجد أسطر جرد في الطلب." });
      return;
    }
    const entries = rawEntries.map((entry: Record<string, unknown>) => ({
      lineId: Number(entry?.lineId),
      countedQuantity:
        entry?.countedQuantity === null || entry?.countedQuantity === undefined || entry?.countedQuantity === ""
          ? null
          : Number(entry.countedQuantity),
      varianceReason: entry?.varianceReason ? String(entry.varianceReason) : null,
    }));
    const session = await recordCountEntries(id, entries, res.locals.user?.fullName ?? null);
    res.json(session);
  } catch (error) {
    countFailure(res, error);
  }
});

// POST /api/counts/:id/approve - posts every difference as an adjustment
router.post("/:id/approve", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الجلسة غير صالح." });
      return;
    }
    const result = await approveCountSession(
      id,
      movementContextFromRequest(req),
      res.locals.user ?? null,
    );
    await auditLog({
      req,
      action: "approve",
      entityType: "count_session",
      entityId: id,
      details: { posted: result.posted.length, sessionCode: result.session.code },
    });
    res.json({
      ok: true,
      posted: result.posted.length,
      session: {
        id: result.session.id,
        code: result.session.code,
        status: result.session.status,
        varianceLines: result.session.varianceLines,
        totalVariance: result.session.totalVariance,
      },
    });
  } catch (error) {
    countFailure(res, error);
  }
});

// POST /api/counts/:id/cancel
router.post("/:id/cancel", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الجلسة غير صالح." });
      return;
    }
    const session = await cancelCountSession(id);
    await auditLog({ req, action: "cancel", entityType: "count_session", entityId: id });
    res.json(session);
  } catch (error) {
    countFailure(res, error);
  }
});

export default router;
