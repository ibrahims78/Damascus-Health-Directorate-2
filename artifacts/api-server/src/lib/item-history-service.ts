import {
  categoriesTable,
  db,
  inventoryBatchesTable,
  itemsTable,
  transactionBatchAllocationsTable,
  transactionsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";

export const ITEM_HISTORY_TYPES = [
  "in",
  "out",
  "adjust",
  "custody_out",
  "custody_return",
  "damage",
  "central_return",
] as const;

export type ItemHistoryType = (typeof ITEM_HISTORY_TYPES)[number];

export type ItemHistoryFilters = {
  type?: ItemHistoryType;
  from?: string;
  to?: string;
  document?: string;
  page?: number;
  limit?: number;
};

function asDateString(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export async function getItemHistory(itemId: number, filters: ItemHistoryFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
  const offset = (page - 1) * limit;
  const conditions = [eq(itemsTable.id, itemId), eq(itemsTable.isActive, true)];

  if (filters.type) conditions.push(eq(transactionsTable.type, filters.type));
  if (filters.from) conditions.push(gte(transactionsTable.documentDate, filters.from));
  if (filters.to) conditions.push(lte(transactionsTable.documentDate, filters.to));
  if (filters.document) {
    conditions.push(ilike(transactionsTable.documentNumber, `%${filters.document}%`));
  }

  const where = and(...conditions);
  const [itemRows, batches, movementRows, totalRows] = await Promise.all([
    db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        categoryId: itemsTable.categoryId,
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
      .where(and(eq(itemsTable.id, itemId), eq(itemsTable.isActive, true))),
    db
      .select({
        id: inventoryBatchesTable.id,
        batchNumber: inventoryBatchesTable.batchNumber,
        receivedQuantity: inventoryBatchesTable.receivedQuantity,
        remainingQuantity: inventoryBatchesTable.remainingQuantity,
        expiryDate: inventoryBatchesTable.expiryDate,
        deliveryNoteNumber: inventoryBatchesTable.deliveryNoteNumber,
        deliveryNoteDate: inventoryBatchesTable.deliveryNoteDate,
        createdAt: inventoryBatchesTable.createdAt,
      })
      .from(inventoryBatchesTable)
      .where(eq(inventoryBatchesTable.itemId, itemId))
      .orderBy(
        sql`${inventoryBatchesTable.expiryDate} ASC NULLS LAST`,
        asc(inventoryBatchesTable.id),
      ),
    db
      .select({
        id: transactionsTable.id,
        type: transactionsTable.type,
        itemType: transactionsTable.itemType,
        itemId: transactionsTable.itemId,
        quantity: transactionsTable.quantity,
        recipientName: transactionsTable.recipientNameSnap,
        holderName: transactionsTable.custodyHolderNameSnap,
        documentNumber: transactionsTable.documentNumber,
        documentDate: transactionsTable.documentDate,
        expiryDate: transactionsTable.expiryDate,
        batchNumber: transactionsTable.batchNumber,
        reason: transactionsTable.reason,
        notes: transactionsTable.notes,
        isHistoricalIncomplete: transactionsTable.isHistoricalIncomplete,
        createdAt: transactionsTable.createdAt,
        operatorName: usersTable.fullName,
      })
      .from(transactionsTable)
      .leftJoin(usersTable, eq(transactionsTable.createdBy, usersTable.id))
      .where(
        and(
          eq(transactionsTable.itemId, itemId),
          filters.type ? eq(transactionsTable.type, filters.type) : undefined,
          filters.from ? gte(transactionsTable.documentDate, filters.from) : undefined,
          filters.to ? lte(transactionsTable.documentDate, filters.to) : undefined,
          filters.document
            ? ilike(transactionsTable.documentNumber, `%${filters.document}%`)
            : undefined,
        ),
      )
      .orderBy(
        sql`${transactionsTable.documentDate} ASC NULLS LAST`,
        asc(transactionsTable.createdAt),
        asc(transactionsTable.id),
      )
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.itemId, itemId),
          filters.type ? eq(transactionsTable.type, filters.type) : undefined,
          filters.from ? gte(transactionsTable.documentDate, filters.from) : undefined,
          filters.to ? lte(transactionsTable.documentDate, filters.to) : undefined,
          filters.document
            ? ilike(transactionsTable.documentNumber, `%${filters.document}%`)
            : undefined,
        ),
      ),
  ]);

  const item = itemRows[0];
  if (!item) return null;

  const movementIds = movementRows.map((movement) => movement.id);
  const allocationRows = movementIds.length
    ? await db
        .select({
          transactionId: transactionBatchAllocationsTable.transactionId,
          batchId: transactionBatchAllocationsTable.batchId,
          quantity: transactionBatchAllocationsTable.quantity,
          batchNumber: transactionBatchAllocationsTable.batchNumberSnap,
          expiryDate: transactionBatchAllocationsTable.expiryDateSnap,
        })
        .from(transactionBatchAllocationsTable)
        .where(inArray(transactionBatchAllocationsTable.transactionId, movementIds))
        .orderBy(asc(transactionBatchAllocationsTable.id))
    : [];

  const allocationsByTransaction = new Map<number, typeof allocationRows>();
  for (const allocation of allocationRows) {
    const existing = allocationsByTransaction.get(allocation.transactionId) ?? [];
    existing.push(allocation);
    allocationsByTransaction.set(allocation.transactionId, existing);
  }

  return {
    item: {
      ...item,
      createdAt: asDateString(item.createdAt),
      updatedAt: asDateString(item.updatedAt),
    },
    batches: batches.map((batch) => ({
      ...batch,
      createdAt: asDateString(batch.createdAt),
    })),
    movements: movementRows.map((movement) => {
      const allocations = allocationsByTransaction.get(movement.id) ?? [];
      return {
        ...movement,
        documentDate: movement.documentDate ?? null,
        createdAt: asDateString(movement.createdAt),
        partyName:
          movement.recipientName ??
          movement.holderName ??
          (movement.type === "central_return" ? "المستودعات المركزية" : null),
        batchNumber: movement.batchNumber ?? allocations[0]?.batchNumber ?? null,
        expiryDate: movement.expiryDate ?? allocations[0]?.expiryDate ?? null,
        isHistoricalIncomplete:
          movement.isHistoricalIncomplete ||
          !movement.documentDate ||
          movement.quantity === null,
        allocations: allocations.map((allocation) => ({
          batchId: allocation.batchId,
          quantity: allocation.quantity,
          batchNumber: allocation.batchNumber,
          expiryDate: allocation.expiryDate,
        })),
      };
    }),
    total: Number(totalRows[0]?.count ?? 0),
    page,
    limit,
  };
}