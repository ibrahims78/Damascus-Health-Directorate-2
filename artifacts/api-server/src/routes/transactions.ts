import { Router, type Request, type Response } from "express";
import {
  db,
  equipmentTable,
  itemsTable,
  systemSettingsTable,
  transactionBatchAllocationsTable,
  transactionsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { scopedWarehouseId } from "../lib/scope";
import { getCurrentWarehouse } from "../lib/warehouse-service";
import { auditLog } from "../middlewares/audit";
import { runAlertWorker } from "../lib/alert-worker";
import {
  createInventoryMovement,
  movementContextFromRequest,
} from "../lib/inventory-movement-service";
import { InventoryMovementError, assertMeaningfulReason } from "../lib/inventory-movement-core";

const router = Router();

function movementFailureResponse(
  res: Response,
  error: unknown,
) {
  const movementError =
    error instanceof InventoryMovementError
      ? error
      : new InventoryMovementError(
          "INTERNAL_MOVEMENT_ERROR",
          "تعذر تنفيذ الحركة بسبب خطأ داخلي",
          500,
        );

  res.status(movementError.status).json({
    error: movementError.message,
    code: movementError.code,
    ...(movementError.details ? { details: movementError.details } : {}),
  });
}

async function executeMovement(
  req: Request,
  res: Response,
  input: Record<string, unknown>,
) {
  try {
    const transaction = await createInventoryMovement(
      input as never,
      movementContextFromRequest(req),
    );
    res.status(201).json(transaction);
    runAlertWorker().catch((error) => console.error("Alert worker:", error));
  } catch (error) {
    console.error("[movement]", error);
    movementFailureResponse(res, error);
  }
}

// GET /api/transactions
router.get("/", requireAuth, async (req, res) => {
  try {
    const { type, itemType, from, to, search, page = "1", limit = "50" } =
      req.query as Record<string, string>;
    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];
    if (type) conditions.push(eq(transactionsTable.type, type as never));
    if (itemType) conditions.push(eq(transactionsTable.itemType, itemType as never));
    if (from) conditions.push(gte(transactionsTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(transactionsTable.createdAt, new Date(to)));
    if (search) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(transactionsTable.documentNumber, term),
          ilike(itemsTable.name, term),
          ilike(equipmentTable.name, term),
          ilike(transactionsTable.recipientNameSnap, term),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const scope = scopedWarehouseId(res.locals.user);
    if (scope !== null) conditions.push(eq(transactionsTable.warehouseId, scope));
    const [transactions, totalResult] = await Promise.all([
      db
        .select({
          id: transactionsTable.id,
          type: transactionsTable.type,
          itemType: transactionsTable.itemType,
          itemId: transactionsTable.itemId,
          itemName: itemsTable.name,
          itemUnit: itemsTable.unit,
          equipmentId: transactionsTable.equipmentId,
          equipmentName: equipmentTable.name,
          quantity: transactionsTable.quantity,
          recipientId: transactionsTable.recipientId,
          recipientName: transactionsTable.recipientNameSnap,
          recipientPerson: transactionsTable.recipientPerson,
          exitReasonId: transactionsTable.exitReasonId,
          exitReason: transactionsTable.exitReasonSnap,
          documentNumber: transactionsTable.documentNumber,
          documentDate: transactionsTable.documentDate,
          notes: transactionsTable.notes,
          createdByName: usersTable.fullName,
          createdAt: transactionsTable.createdAt,
          reversedById: transactionsTable.reversedById,
          reversedAt: transactionsTable.reversedAt,
        })
        .from(transactionsTable)
        .leftJoin(itemsTable, eq(transactionsTable.itemId, itemsTable.id))
        .leftJoin(equipmentTable, eq(transactionsTable.equipmentId, equipmentTable.id))
        .leftJoin(usersTable, eq(transactionsTable.createdBy, usersTable.id))
        .where(where)
        .orderBy(sql`${transactionsTable.createdAt} DESC`)
        .limit(limitNum)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(transactionsTable)
        .leftJoin(itemsTable, eq(transactionsTable.itemId, itemsTable.id))
        .leftJoin(equipmentTable, eq(transactionsTable.equipmentId, equipmentTable.id))
        .where(where),
    ]);
    res.json({
      transactions,
      total: Number(totalResult[0]?.count ?? 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

router.post(
  "/in",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (req, res) => {
    const current = await getCurrentWarehouse();
    if (current && current.type === "branch") {
      res.status(403).json({ error: "الإدخال المباشر غير متاح للمستودعات الفرعية؛ استخدم استلام تحويل من المركزي.", code: "BRANCH_INBOUND_VIA_TRANSFER_ONLY" });
      return;
    }
    return executeMovement(req, res, { ...req.body, kind: "in" });
  },
);

router.post(
  "/out",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (req, res) => executeMovement(req, res, { ...req.body, kind: "out" }),
);

router.post(
  "/adjust",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (req, res) => executeMovement(req, res, { ...req.body, kind: "adjust" }),
);

router.post(
  "/custody-out",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (req, res) =>
    executeMovement(req, res, { ...req.body, kind: "custody_out" }),
);

router.post(
  "/custody-return",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (req, res) =>
    executeMovement(req, res, { ...req.body, kind: "custody_return" }),
);

router.post(
  "/damage",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (req, res) => executeMovement(req, res, { ...req.body, kind: "damage" }),
);

router.post(
  "/central-return",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (req, res) =>
    executeMovement(req, res, { ...req.body, kind: "central_return" }),
);

async function getTransaction(id: number) {
  return db
    .select({
      id: transactionsTable.id,
      type: transactionsTable.type,
      itemType: transactionsTable.itemType,
      itemId: transactionsTable.itemId,
      itemName: itemsTable.name,
      itemUnit: itemsTable.unit,
      equipmentId: transactionsTable.equipmentId,
      equipmentName: equipmentTable.name,
      quantity: transactionsTable.quantity,
      recipientId: transactionsTable.recipientId,
      recipientName: transactionsTable.recipientNameSnap,
      recipientPerson: transactionsTable.recipientPerson,
      exitReasonId: transactionsTable.exitReasonId,
      exitReason: transactionsTable.exitReasonSnap,
      supplier: itemsTable.supplier,
      batchNumber: transactionsTable.batchNumber,
      expiryDate: transactionsTable.expiryDate,
      documentNumber: transactionsTable.documentNumber,
      documentDate: transactionsTable.documentDate,
      deliveryNoteNumber: transactionsTable.deliveryNoteNumber,
      deliveryNoteDate: transactionsTable.deliveryNoteDate,
      internalDeliveryNoteNumber: transactionsTable.internalDeliveryNoteNumber,
      internalDeliveryNoteDate: transactionsTable.internalDeliveryNoteDate,
      deliveryDestination: transactionsTable.deliveryDestination,
      custodyHolderName: transactionsTable.custodyHolderNameSnap,
      custodyNoteNumber: transactionsTable.custodyNoteNumber,
      custodyDate: transactionsTable.custodyDate,
      custodyLocation: transactionsTable.custodyLocation,
      returnCondition: transactionsTable.returnCondition,
      reason: transactionsTable.reason,
      notes: transactionsTable.notes,
      details: transactionsTable.details,
      createdByName: usersTable.fullName,
      createdAt: transactionsTable.createdAt,
    })
    .from(transactionsTable)
    .leftJoin(itemsTable, eq(transactionsTable.itemId, itemsTable.id))
    .leftJoin(equipmentTable, eq(transactionsTable.equipmentId, equipmentTable.id))
    .leftJoin(usersTable, eq(transactionsTable.createdBy, usersTable.id))
    .where(eq(transactionsTable.id, id))
    .then((rows) => rows[0]);
}

// POST /api/transactions/:id/reverse - compensating document, never an edit
router.post("/:id/reverse", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الحركة غير صالح." });
      return;
    }
    const [original] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id)).limit(1);
    if (!original) {
      res.status(404).json({ error: "الحركة غير موجودة." });
      return;
    }
    if (original.reversedById) {
      res.status(409).json({ error: "تم عكس هذه الحركة مسبقًا.", code: "ALREADY_REVERSED" });
      return;
    }
    if (original.reversalOfId) {
      res.status(409).json({ error: "لا يمكن عكس قيد عكسي.", code: "CANNOT_REVERSE_REVERSAL" });
      return;
    }
    if (String(original.type).startsWith("custody")) {
      res.status(409).json({
        error: "حركات العهدة تُدار عبر دورة العهدة (إرجاع) لا عبر قيد عكسي.",
        code: "CUSTODY_USE_RETURN_FLOW",
      });
      return;
    }
    const reason = assertMeaningfulReason(req.body?.reason, "reason");
    const details = (original.details ?? {}) as Record<string, unknown>;
    const previousStock = details.previousStock;
    const outgoing = ["out", "damage", "central_return", "central-return"].includes(String(original.type));
    const quantity = Number(original.quantity ?? 0);

    let newStock: number | null =
      previousStock !== undefined && previousStock !== null ? Number(previousStock) : null;
    if (newStock === null) {
      if (original.itemType === "item" && original.itemId) {
        const [item] = await db
          .select({ currentStock: itemsTable.currentStock })
          .from(itemsTable)
          .where(eq(itemsTable.id, original.itemId))
          .limit(1);
        const current = Number(item?.currentStock ?? 0);
        newStock = outgoing ? current + quantity : Math.max(current - quantity, 0);
      } else if (original.itemType === "equipment" && original.equipmentId) {
        const [equipment] = await db
          .select({ quantity: equipmentTable.quantity })
          .from(equipmentTable)
          .where(eq(equipmentTable.id, original.equipmentId))
          .limit(1);
        const current = Number(equipment?.quantity ?? 0);
        newStock = outgoing ? current + quantity : Math.max(current - quantity, 0);
      }
    }
    if (newStock === null) {
      res.status(409).json({
        error: "لا يمكن تحديد الرصيد المرجعي لهذه الحركة؛ استخدم تسوية يدوية موثّقة.",
        code: "REVERSAL_NOT_SUPPORTED",
      });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const reversal = await createInventoryMovement(
      {
        kind: "adjust",
        itemType: original.itemType,
        itemId: original.itemId,
        equipmentId: original.equipmentId,
        newStock,
        documentDate: today,
        documentNumber: "REV-" + original.documentNumber,
        reason: "قيد عكسي للمستند " + original.documentNumber + ": " + reason,
        warehouseId: original.warehouseId ?? undefined,
      } as never,
      movementContextFromRequest(req),
    );

    await db
      .update(transactionsTable)
      .set({ reversedById: reversal.id, reversedAt: new Date(), reversalReason: reason })
      .where(eq(transactionsTable.id, id));
    await auditLog({
      req,
      action: "reverse",
      entityType: "transaction",
      entityId: id,
      details: { documentNumber: original.documentNumber, reversalId: reversal.id, reason },
    });
    res.json({ ok: true, reversal });
  } catch (error) {
    console.error("[reversal]", error);
    movementFailureResponse(res, error);
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const transaction = await getTransaction(Number.parseInt(String(req.params.id), 10));
    if (!transaction) {
      res.status(404).json({ error: "الحركة غير موجودة." });
      return;
    }
    res.json(transaction);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

router.get("/:id/print", requireAuth, async (req, res) => {
  try {
    const transaction = await getTransaction(Number.parseInt(String(req.params.id), 10));
    if (!transaction) {
      res.status(404).json({ error: "الحركة غير موجودة." });
      return;
    }
    const settings = await db.query.systemSettingsTable.findFirst();
    // the printed document must show how the quantity was taken from batches
    const allocations = await db
      .select({
        id: transactionBatchAllocationsTable.id,
        batchId: transactionBatchAllocationsTable.batchId,
        quantity: transactionBatchAllocationsTable.quantity,
        batchNumber: transactionBatchAllocationsTable.batchNumberSnap,
        expiryDate: transactionBatchAllocationsTable.expiryDateSnap,
      })
      .from(transactionBatchAllocationsTable)
      .where(eq(transactionBatchAllocationsTable.transactionId, transaction.id));
    res.json({
      transaction,
      allocations,
      organizationName:
        settings?.orgName ?? "مستودعات مديرية صحة دمشق",
      orgSubtitle: settings?.orgSubtitle ?? null,
      printedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

export default router;
