import { Router } from "express";
import {
  db,
  itemsTable,
  equipmentTable,
  transactionsTable,
  categoriesTable,
  usersTable,
  systemSettingsTable,
  personalCustodiesTable,
  inventoryBatchesTable,
  damageRecordsTable,
  warehousesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { eq, and, lte, gte, sql, desc } from "drizzle-orm";

const router = Router();

function parseDateFilter(value: string | undefined, label: string, endOfDay = false): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be an ISO date`);
  }
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid date`);
  }
  return date;
}

// GET /api/reports/stock
router.get("/stock", requireAuth, async (_req, res) => {
  try {
    const items = await db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        categoryName: categoriesTable.name,
        itemType: itemsTable.itemType,
        unit: itemsTable.unit,
        currentStock: itemsTable.currentStock,
        minStock: itemsTable.minStock,
        expiryDate: itemsTable.expiryDate,
        batchNumber: itemsTable.batchNumber,
        location: itemsTable.location,
        supplier: itemsTable.supplier,
        updatedAt: itemsTable.updatedAt,
      })
      .from(itemsTable)
      .leftJoin(categoriesTable, eq(itemsTable.categoryId, categoriesTable.id))
      .where(eq(itemsTable.isActive, true))
      .orderBy(itemsTable.name);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/movements
router.get("/movements", requireAuth, async (req, res) => {
  try {
    const { from, to, type, recipient, search } = req.query as Record<string, string>;
    const conditions = [];
    let fromDate: Date | null;
    let toDate: Date | null;
    try {
      fromDate = parseDateFilter(from, "from");
      toDate = parseDateFilter(to, "to", true);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid date filter" });
      return;
    }
    if (fromDate && toDate && fromDate > toDate) {
      res.status(400).json({ error: "from must be before to" });
      return;
    }
    if (fromDate) conditions.push(gte(transactionsTable.createdAt, fromDate));
    if (toDate) conditions.push(lte(transactionsTable.createdAt, toDate));
    if (type) conditions.push(eq(transactionsTable.type, type as never));
    if (recipient) conditions.push(sql`${transactionsTable.recipientNameSnap} ILIKE ${`%${recipient}%`}`);
    if (search) {
      const term = `%${search}%`;
      conditions.push(sql`(
        ${transactionsTable.documentNumber} ILIKE ${term}
        OR ${transactionsTable.recipientNameSnap} ILIKE ${term}
        OR ${transactionsTable.recipientPerson} ILIKE ${term}
        OR ${itemsTable.name} ILIKE ${term}
        OR ${equipmentTable.name} ILIKE ${term}
      )`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const transactions = await db
      .select({
        id: transactionsTable.id,
        type: transactionsTable.type,
        itemType: transactionsTable.itemType,
        itemName: itemsTable.name,
        itemUnit: itemsTable.unit,
        equipmentName: equipmentTable.name,
        quantity: transactionsTable.quantity,
        recipientName: transactionsTable.recipientNameSnap,
        recipientPerson: transactionsTable.recipientPerson,
        exitReason: transactionsTable.exitReasonSnap,
        documentNumber: transactionsTable.documentNumber,
        notes: transactionsTable.notes,
        createdByName: usersTable.fullName,
        createdAt: transactionsTable.createdAt,
      })
      .from(transactionsTable)
      .leftJoin(itemsTable, eq(transactionsTable.itemId, itemsTable.id))
      .leftJoin(equipmentTable, eq(transactionsTable.equipmentId, equipmentTable.id))
      .leftJoin(usersTable, eq(transactionsTable.createdBy, usersTable.id))
      .where(where)
      .orderBy(desc(transactionsTable.createdAt));
    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/stock-position — reconciled position by ownership/state.
// Damage for consumables is represented by a movement that already reduced
// available stock; equipment damage is represented by its current condition and
// the cumulative damage ledger is returned separately for auditability.
router.get("/stock-position", requireAuth, async (_req, res) => {
  try {
    const [items, equipment, batches, custodyByEquipment, damageByItem, damageByEquipment] =
      await Promise.all([
        db
          .select({
            id: itemsTable.id,
            code: itemsTable.code,
            name: itemsTable.name,
            unit: itemsTable.unit,
            itemType: itemsTable.itemType,
            currentStock: itemsTable.currentStock,
          })
          .from(itemsTable)
          .where(eq(itemsTable.isActive, true))
          .orderBy(itemsTable.name),
        db
          .select({
            id: equipmentTable.id,
            name: equipmentTable.name,
            serialNumber: equipmentTable.serialNumber,
            condition: equipmentTable.condition,
            quantity: equipmentTable.quantity,
            currentHolder: equipmentTable.currentHolder,
          })
          .from(equipmentTable)
          .orderBy(equipmentTable.name),
        db
          .select({
            id: inventoryBatchesTable.id,
            itemId: inventoryBatchesTable.itemId,
            batchNumber: inventoryBatchesTable.batchNumber,
            expiryDate: inventoryBatchesTable.expiryDate,
            remainingQuantity: inventoryBatchesTable.remainingQuantity,
          })
          .from(inventoryBatchesTable)
          .where(sql`${inventoryBatchesTable.remainingQuantity} > 0`)
          .orderBy(sql`${inventoryBatchesTable.expiryDate} ASC NULLS LAST`, inventoryBatchesTable.id),
        db
          .select({
            equipmentId: personalCustodiesTable.equipmentId,
            quantity: sql<number>`coalesce(sum(${personalCustodiesTable.quantity} - ${personalCustodiesTable.returnedQuantity}), 0)`,
          })
          .from(personalCustodiesTable)
          .where(sql`${personalCustodiesTable.status} IN ('open', 'partially_returned', 'damaged')`)
          .groupBy(personalCustodiesTable.equipmentId),
        db
          .select({
            itemId: damageRecordsTable.itemId,
            quantity: sql<number>`coalesce(sum(${damageRecordsTable.quantity}), 0)`,
          })
          .from(damageRecordsTable)
          .where(eq(damageRecordsTable.itemType, "item"))
          .groupBy(damageRecordsTable.itemId),
        db
          .select({
            equipmentId: damageRecordsTable.equipmentId,
            quantity: sql<number>`coalesce(sum(${damageRecordsTable.quantity}), 0)`,
          })
          .from(damageRecordsTable)
          .where(eq(damageRecordsTable.itemType, "equipment"))
          .groupBy(damageRecordsTable.equipmentId),
      ]);

    const custodyMap = new Map(custodyByEquipment.map((row) => [row.equipmentId, Number(row.quantity)]));
    const itemDamageMap = new Map(damageByItem.map((row) => [row.itemId, Number(row.quantity)]));
    const equipmentDamageMap = new Map(
      damageByEquipment.map((row) => [row.equipmentId, Number(row.quantity)]),
    );
    const batchesByItem = new Map<number, typeof batches>();
    for (const batch of batches) {
      const current = batchesByItem.get(batch.itemId) ?? [];
      current.push(batch);
      batchesByItem.set(batch.itemId, current);
    }

    res.json({
      generatedAt: new Date().toISOString(),
      items: items.map((item) => ({
        ...item,
        availableQuantity: item.currentStock,
        custodyQuantity: 0,
        damagedQuantity: itemDamageMap.get(item.id) ?? 0,
        batches: (batchesByItem.get(item.id) ?? []).map((batch) => ({
          ...batch,
          remainingQuantity: Number(batch.remainingQuantity),
        })),
      })),
      equipment: equipment.map((item) => {
        const custodyQuantity = custodyMap.get(item.id) ?? 0;
        return {
          ...item,
          quantity: Number(item.quantity ?? 0),
          availableQuantity: Math.max(0, Number(item.quantity ?? 0) - custodyQuantity),
          custodyQuantity,
          damagedQuantity:
            item.condition === "broken" || item.condition === "consumed"
              ? Number(item.quantity ?? 0)
              : 0,
          damagedLedgerQuantity: equipmentDamageMap.get(item.id) ?? 0,
        };
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/custodies — open, partially returned, and age-overdue custody.
router.get("/custodies", requireAuth, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const overdueDaysRaw = Number.parseInt(String(req.query.overdueDays ?? "30"), 10);
    const overdueDays = Number.isSafeInteger(overdueDaysRaw)
      ? Math.min(3650, Math.max(1, overdueDaysRaw))
      : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - overdueDays);
    const conditions = [
      sql`${personalCustodiesTable.status} IN ('open', 'partially_returned', 'damaged')`,
    ];
    if (status) conditions.push(eq(personalCustodiesTable.status, status as never));
    if (search) {
      const term = `%${search}%`;
      conditions.push(sql`(
        ${personalCustodiesTable.holderNameSnap} ILIKE ${term}
        OR ${personalCustodiesTable.deliveryNoteNumber} ILIKE ${term}
        OR ${equipmentTable.name} ILIKE ${term}
        OR ${equipmentTable.serialNumber} ILIKE ${term}
      )`);
    }

    const rows = await db
      .select({
        id: personalCustodiesTable.id,
        equipmentId: personalCustodiesTable.equipmentId,
        equipmentName: equipmentTable.name,
        serialNumber: equipmentTable.serialNumber,
        holderName: personalCustodiesTable.holderNameSnap,
        quantity: personalCustodiesTable.quantity,
        returnedQuantity: personalCustodiesTable.returnedQuantity,
        outstandingQuantity: sql<number>`${personalCustodiesTable.quantity} - ${personalCustodiesTable.returnedQuantity}`,
        deliveryNoteNumber: personalCustodiesTable.deliveryNoteNumber,
        deliveryDate: personalCustodiesTable.deliveryDate,
        location: personalCustodiesTable.location,
        status: personalCustodiesTable.status,
        overdue: sql<boolean>`${personalCustodiesTable.deliveryDate} < ${cutoff.toISOString().slice(0, 10)}`,
      })
      .from(personalCustodiesTable)
      .innerJoin(equipmentTable, eq(personalCustodiesTable.equipmentId, equipmentTable.id))
      .where(and(...conditions))
      .orderBy(desc(personalCustodiesTable.deliveryDate), desc(personalCustodiesTable.id));

    res.json({
      overdueDays,
      generatedAt: new Date().toISOString(),
      records: rows.map((row) => ({
        ...row,
        quantity: Number(row.quantity),
        returnedQuantity: Number(row.returnedQuantity),
        outstandingQuantity: Number(row.outstandingQuantity),
      })),
      totals: {
        open: rows.filter((row) => row.status === "open").length,
        partial: rows.filter((row) => row.status === "partially_returned").length,
        overdue: rows.filter((row) => row.overdue).length,
        outstandingQuantity: rows.reduce((sum, row) => sum + Number(row.outstandingQuantity), 0),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/expiry
router.get("/expiry", requireAuth, async (_req, res) => {
  try {
    const settings = await db.query.systemSettingsTable.findFirst();
    const alertDays = settings?.expiryAlertDays ?? 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + alertDays);

    const items = await db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        categoryName: categoriesTable.name,
        unit: itemsTable.unit,
        currentStock: itemsTable.currentStock,
        expiryDate: itemsTable.expiryDate,
        batchNumber: itemsTable.batchNumber,
        location: itemsTable.location,
        supplier: itemsTable.supplier,
      })
      .from(itemsTable)
      .leftJoin(categoriesTable, eq(itemsTable.categoryId, categoriesTable.id))
      .where(
        and(
          eq(itemsTable.isActive, true),
          sql`${itemsTable.expiryDate} IS NOT NULL AND ${itemsTable.expiryDate} <= ${cutoffDate.toISOString().split("T")[0]}`
        )
      )
      .orderBy(itemsTable.expiryDate);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/near-expiry — active items expiring within the configured
// window, excluding items that have already expired.
router.get("/near-expiry", requireAuth, async (_req, res) => {
  try {
    const settings = await db.query.systemSettingsTable.findFirst();
    const alertDays = settings?.expiryAlertDays ?? 30;
    const today = new Date();
    const cutoffDate = new Date(today);
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() + alertDays);
    const todayString = today.toISOString().split("T")[0];
    const cutoffString = cutoffDate.toISOString().split("T")[0];

    const items = await db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        categoryName: categoriesTable.name,
        itemType: itemsTable.itemType,
        unit: itemsTable.unit,
        currentStock: itemsTable.currentStock,
        minStock: itemsTable.minStock,
        expiryDate: itemsTable.expiryDate,
        batchNumber: itemsTable.batchNumber,
        location: itemsTable.location,
        supplier: itemsTable.supplier,
        notes: itemsTable.notes,
        isActive: itemsTable.isActive,
        createdAt: itemsTable.createdAt,
        updatedAt: itemsTable.updatedAt,
      })
      .from(itemsTable)
      .leftJoin(categoriesTable, eq(itemsTable.categoryId, categoriesTable.id))
      .where(
        and(
          eq(itemsTable.isActive, true),
          sql`${itemsTable.expiryDate} IS NOT NULL
              AND ${itemsTable.expiryDate} > ${todayString}
              AND ${itemsTable.expiryDate} <= ${cutoffString}`,
        ),
      )
      .orderBy(itemsTable.expiryDate);

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/stagnant — active, stocked items with no movement for more
// than the configured threshold. The current product rule is seven months;
// every transaction type counts as movement, including the opening movement.
router.get("/stagnant", requireAuth, async (_req, res) => {
  try {
    const staleMonths = 7;
    const cutoffDate = new Date();
    cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - staleMonths);

    const rows = await db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        categoryName: categoriesTable.name,
        itemType: itemsTable.itemType,
        unit: itemsTable.unit,
        currentStock: itemsTable.currentStock,
        minStock: itemsTable.minStock,
        location: itemsTable.location,
        supplier: itemsTable.supplier,
        createdAt: itemsTable.createdAt,
        lastMovementAt: sql<Date | null>`
          MAX(${transactionsTable.createdAt})
        `,
      })
      .from(itemsTable)
      .leftJoin(categoriesTable, eq(itemsTable.categoryId, categoriesTable.id))
      .leftJoin(
        transactionsTable,
        and(
          eq(transactionsTable.itemId, itemsTable.id),
          eq(transactionsTable.itemType, "item"),
        ),
      )
      .where(
        and(
          eq(itemsTable.isActive, true),
          sql`${itemsTable.currentStock} > 0`,
        ),
      )
      .groupBy(
        itemsTable.id,
        itemsTable.code,
        itemsTable.name,
        categoriesTable.name,
        itemsTable.itemType,
        itemsTable.unit,
        itemsTable.currentStock,
        itemsTable.minStock,
        itemsTable.location,
        itemsTable.supplier,
        itemsTable.createdAt,
      )
      .having(
        sql`COALESCE(MAX(${transactionsTable.createdAt}), ${itemsTable.createdAt}) < ${cutoffDate}`,
      )
      .orderBy(
        sql`COALESCE(MAX(${transactionsTable.createdAt}), ${itemsTable.createdAt}) ASC`,
      );

    res.json({
      staleMonths,
      cutoffDate: cutoffDate.toISOString(),
      items: rows.map((row) => {
        const lastMovement = row.lastMovementAt
          ? new Date(row.lastMovementAt)
          : null;
        const referenceDate = lastMovement ?? new Date(row.createdAt);
        const idleDays = Math.max(
          0,
          Math.floor((Date.now() - referenceDate.getTime()) / 86_400_000),
        );
        return {
          ...row,
          lastMovementAt: lastMovement?.toISOString() ?? null,
          idleDays,
        };
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/below-min
router.get("/below-min", requireAuth, async (_req, res) => {
  try {
    const items = await db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        categoryName: categoriesTable.name,
        itemType: itemsTable.itemType,
        unit: itemsTable.unit,
        currentStock: itemsTable.currentStock,
        minStock: itemsTable.minStock,
        location: itemsTable.location,
        supplier: itemsTable.supplier,
      })
      .from(itemsTable)
      .leftJoin(categoriesTable, eq(itemsTable.categoryId, categoriesTable.id))
      .where(
        and(
          eq(itemsTable.isActive, true),
          lte(itemsTable.currentStock, itemsTable.minStock)
        )
      )
      .orderBy(itemsTable.currentStock);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/equipment
router.get("/equipment", requireAuth, async (_req, res) => {
  try {
    const equipment = await db.query.equipmentTable.findMany({
      orderBy: (e, { asc }) => [asc(e.name)],
    });
    res.json(equipment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/reconciliation
// Compares the cached per-item balance with the sum of its remaining batch
// quantities. Any non-zero delta is a data-integrity finding that an
// administrator must review (an adjustment can legitimately leave the cached
// balance ahead/behind the batch ledger).
router.get("/reconciliation", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        unit: itemsTable.unit,
        currentStock: itemsTable.currentStock,
        batchTotal: sql<number>`coalesce(sum(${inventoryBatchesTable.remainingQuantity}), 0)`,
        batchCount: sql<number>`count(${inventoryBatchesTable.id})`,
      })
      .from(itemsTable)
      .leftJoin(inventoryBatchesTable, eq(inventoryBatchesTable.itemId, itemsTable.id))
      .where(eq(itemsTable.isActive, true))
      .groupBy(itemsTable.id, itemsTable.code, itemsTable.name, itemsTable.unit, itemsTable.currentStock);

    const items = rows
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        unit: row.unit,
        currentStock: Number(row.currentStock ?? 0),
        batchTotal: Number(row.batchTotal ?? 0),
        batchCount: Number(row.batchCount ?? 0),
      }))
      .map((row) => ({ ...row, delta: row.currentStock - row.batchTotal }))
      .filter((row) => row.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    res.json({
      checked: rows.length,
      mismatches: items.length,
      items,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/stock-by-warehouse
// Balance per (item x warehouse) computed from the batch ledger. Batches are
// the source of truth for stored quantities; the cached items.current_stock
// stays a global figure whose drift is reported by /reconciliation.
router.get("/stock-by-warehouse", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({
        warehouseId: inventoryBatchesTable.warehouseId,
        itemId: inventoryBatchesTable.itemId,
        quantity: sql<number>`coalesce(sum(${inventoryBatchesTable.remainingQuantity}), 0)`,
      })
      .from(inventoryBatchesTable)
      .groupBy(inventoryBatchesTable.warehouseId, inventoryBatchesTable.itemId);

    const items = await db
      .select({ id: itemsTable.id, code: itemsTable.code, name: itemsTable.name, unit: itemsTable.unit })
      .from(itemsTable)
      .where(eq(itemsTable.isActive, true));
    const itemById = new Map(items.map((i) => [i.id, i]));

    const warehouses = await db
      .select({ id: warehousesTable.id, code: warehousesTable.code, name: warehousesTable.name, type: warehousesTable.type })
      .from(warehousesTable);
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

    const positions = rows
      .map((row) => ({
        warehouseId: row.warehouseId,
        warehouse: warehouseById.get(Number(row.warehouseId)) ?? null,
        itemId: row.itemId,
        item: itemById.get(Number(row.itemId)) ?? null,
        quantity: Number(row.quantity ?? 0),
      }))
      .filter((row) => row.item && row.quantity !== 0)
      .sort((a, b) => String(a.warehouse?.code ?? "").localeCompare(String(b.warehouse?.code ?? "")) || String(a.item?.name ?? "").localeCompare(String(b.item?.name ?? "")));

    const byWarehouse = Array.from(
      positions.reduce((acc, row) => {
        const key = String(row.warehouseId);
        const entry = acc.get(key) ?? { warehouseId: row.warehouseId, warehouse: row.warehouse, lines: 0, quantity: 0 };
        entry.lines += 1;
        entry.quantity += row.quantity;
        acc.set(key, entry);
        return acc;
      }, new Map<string, { warehouseId: unknown; warehouse: unknown; lines: number; quantity: number }>()).values(),
    );

    res.json({ positions, byWarehouse, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/consolidated
// Phase 8: the management-wide view. A branch only sees its own balance
// (agreed decision), so the consolidated figures are admin-only.
router.get("/consolidated", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const batchRows = await db
      .select({
        warehouseId: inventoryBatchesTable.warehouseId,
        itemId: inventoryBatchesTable.itemId,
        quantity: sql<number>`coalesce(sum(${inventoryBatchesTable.remainingQuantity}), 0)`,
      })
      .from(inventoryBatchesTable)
      .groupBy(inventoryBatchesTable.warehouseId, inventoryBatchesTable.itemId);

    const items = await db
      .select({ id: itemsTable.id, minStock: itemsTable.minStock })
      .from(itemsTable)
      .where(eq(itemsTable.isActive, true));
    const minById = new Map(items.map((i) => [i.id, Number(i.minStock ?? 0)]));

    const warehouseRows = await db
      .select({ id: warehousesTable.id, code: warehousesTable.code, name: warehousesTable.name, type: warehousesTable.type })
      .from(warehousesTable);

    const perWarehouse = new Map<number, { warehouseId: number; warehouse: unknown; lines: number; quantity: number; belowMin: number }>();
    for (const w of warehouseRows) {
      perWarehouse.set(w.id, { warehouseId: w.id, warehouse: w, lines: 0, quantity: 0, belowMin: 0 });
    }
    for (const row of batchRows) {
      const qty = Number(row.quantity ?? 0);
      if (qty === 0) continue;
      const key = Number(row.warehouseId ?? 0);
      const entry = perWarehouse.get(key) ?? { warehouseId: key, warehouse: null, lines: 0, quantity: 0, belowMin: 0 };
      entry.lines += 1;
      entry.quantity += qty;
      const min = minById.get(Number(row.itemId)) ?? 0;
      if (min > 0 && qty < min) entry.belowMin += 1;
      perWarehouse.set(key, entry);
    }

    const [equipmentRows] = await db.select({ count: sql<number>`count(*)` }).from(equipmentTable);
    const warehousesOut = Array.from(perWarehouse.values()).sort((a, b) => String((a.warehouse as { code?: string } | null)?.code ?? "").localeCompare(String((b.warehouse as { code?: string } | null)?.code ?? "")));

    res.json({
      totals: {
        items: items.length,
        equipment: Number(equipmentRows?.count ?? 0),
        quantity: warehousesOut.reduce((sum, w) => sum + w.quantity, 0),
        belowMin: warehousesOut.reduce((sum, w) => sum + w.belowMin, 0),
        warehouses: warehousesOut.length,
      },
      warehouses: warehousesOut,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
