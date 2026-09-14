import { Router, type Request, type Response } from "express";
import {
  db,
  equipmentTable,
  itemsTable,
  systemSettingsTable,
  transactionsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { runAlertWorker } from "../lib/alert-worker";
import {
  createInventoryMovement,
  movementContextFromRequest,
} from "../lib/inventory-movement-service";
import { InventoryMovementError } from "../lib/inventory-movement-core";

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
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/in",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (req, res) => executeMovement(req, res, { ...req.body, kind: "in" }),
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

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const transaction = await getTransaction(Number.parseInt(String(req.params.id), 10));
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    res.json(transaction);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/print", requireAuth, async (req, res) => {
  try {
    const transaction = await getTransaction(Number.parseInt(String(req.params.id), 10));
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    const settings = await db.query.systemSettingsTable.findFirst();
    res.json({
      transaction,
      organizationName:
        settings?.orgName ?? "مستودعات مديرية صحة دمشق",
      orgSubtitle: settings?.orgSubtitle ?? null,
      printedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;