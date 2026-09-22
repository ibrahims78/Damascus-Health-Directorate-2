import { Router, type Response } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import {
  ReceiptError,
  cancelReceipt,
  createReceipt,
  getReceipt,
  listReceipts,
  postReceipt,
  receiptSummary,
} from "../lib/receipts-service";
import { movementContextFromRequest } from "../lib/inventory-movement-service";
import { resolveScopedWarehouse, scopedWarehouseId, withinScope } from "../lib/scope";
import { getCurrentWarehouse } from "../lib/warehouse-service";

/**
 * P0-2 - goods receipt notes (GRN) with inspection and partial receipts.
 * Raising and posting are warehouse operations; both are audited.
 */
const router = Router();

function receiptFailure(res: Response, error: unknown) {
  if (error instanceof ReceiptError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
}

// GET /api/receipts
router.get("/", requireAuth, async (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit ?? "100"), 10);
    const scope = scopedWarehouseId(res.locals.user);
    const rows = await listReceipts(Number.isFinite(limit) ? limit : 100);
    res.json(scope === null ? rows : rows.filter((row) => withinScope(res.locals.user, row.warehouseId)));
  } catch (error) {
    receiptFailure(res, error);
  }
});

// GET /api/receipts/summary - receiving performance per supplier
router.get("/summary", requireAuth, requireRole("admin", "warehouse_manager"), async (_req, res) => {
  try {
    const rows = await receiptSummary();
    res.json({
      suppliers: rows,
      received: rows.reduce((sum, row) => sum + row.received, 0),
      rejected: rows.reduce((sum, row) => sum + row.rejected, 0),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    receiptFailure(res, error);
  }
});

// GET /api/receipts/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف السند غير صالح." });
      return;
    }
    res.json(await getReceipt(id));
  } catch (error) {
    receiptFailure(res, error);
  }
});

// POST /api/receipts
router.post("/", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const current = await getCurrentWarehouse();
    if (!current) {
      res.status(409).json({ error: "لا يوجد مستودع حالي معرّف.", code: "NO_WAREHOUSE" });
      return;
    }
    if (current.type === "branch") {
      res.status(403).json({ error: "إنشاء سند استلام من مورد متاح للمستودع المركزي فقط؛ استخدم استلام تحويل من المركزي.", code: "BRANCH_NO_SUPPLIER_RECEIPT" });
      return;
    }
    const requested = Number(req.body?.warehouseId ?? current.id);
    const receipt = await createReceipt({
      warehouseId: resolveScopedWarehouse(res.locals.user, requested, current.id),
      supplierName: req.body?.supplierName ? String(req.body.supplierName).trim() : null,
      deliveryNoteNumber: req.body?.deliveryNoteNumber ? String(req.body.deliveryNoteNumber).trim() : null,
      deliveryNoteDate: req.body?.deliveryNoteDate ? String(req.body.deliveryNoteDate).trim() : null,
      referenceNumber: req.body?.referenceNumber ? String(req.body.referenceNumber).trim() : null,
      notes: req.body?.notes ? String(req.body.notes).trim() : null,
      lines: Array.isArray(req.body?.lines) ? req.body.lines : [],
      userId: res.locals.user?.id ?? null,
      userName: res.locals.user?.fullName ?? null,
    });
    await auditLog({
      req,
      action: "create",
      entityType: "receipt",
      entityId: receipt.id,
      details: { code: receipt.code, lines: receipt.linesCount },
    });
    res.status(201).json(receipt);
  } catch (error) {
    receiptFailure(res, error);
  }
});

// POST /api/receipts/:id/post - accepted quantities enter stock
router.post("/:id/post", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف السند غير صالح." });
      return;
    }
    const result = await postReceipt(id, movementContextFromRequest(req), res.locals.user ?? null);
    await auditLog({
      req,
      action: "post",
      entityType: "receipt",
      entityId: id,
      details: { code: result.receipt.code, received: result.receivedTotal, rejected: result.rejectedTotal },
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    receiptFailure(res, error);
  }
});

// POST /api/receipts/:id/cancel
router.post("/:id/cancel", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف السند غير صالح." });
      return;
    }
    const receipt = await cancelReceipt(id);
    await auditLog({ req, action: "cancel", entityType: "receipt", entityId: id });
    res.json(receipt);
  } catch (error) {
    receiptFailure(res, error);
  }
});

export default router;
