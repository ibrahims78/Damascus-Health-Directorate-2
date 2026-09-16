import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import {
  listImportBatches,
  rollbackImportBatch,
  RollbackError,
} from "../lib/import-batches-service";

/**
 * Phase 3 - import governance.
 * Journal of committed imports plus an admin rollback endpoint.
 */
const router = Router();

// GET /api/import-batches
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? "100"), 10);
    res.json(await listImportBatches(Number.isFinite(limit) ? limit : 100));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/import-batches/:id/rollback
router.post("/:id/rollback", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف دفعة الاستيراد غير صالح." });
      return;
    }
    const result = await rollbackImportBatch(id, res.locals.user?.id ?? null);
    await auditLog({
      req,
      action: "rollback",
      entityType: "import_batch",
      entityId: id,
      details: result,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RollbackError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

export default router;
