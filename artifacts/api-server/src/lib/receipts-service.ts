import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, itemsTable, receiptLinesTable, receiptsTable } from "@workspace/db";
import type { MovementContext } from "./inventory-movement-service";
import { createInventoryMovement } from "./inventory-movement-service";
import { nextDocumentNumber } from "./warehouse-service";

/**
 * P0-2 - goods receipt note (GRN) with inspection and partial receipts.
 *
 * Flow: draft -> posted (or cancelled). Posting turns the accepted quantity of
 * every line into a normal inbound movement, so batches, allocations, alerts and
 * the audit trail all behave exactly like a manual receipt. Rejected quantities
 * are recorded on the line and never enter stock.
 */

export class ReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type ReceiptLineInput = {
  itemId: number;
  orderedQuantity?: number | null;
  receivedQuantity?: number | null;
  rejectedQuantity?: number | null;
  rejectionReason?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  inspectionNotes?: string | null;
  unitCost?: number | null;
};

export async function createReceipt(input: {
  warehouseId: number;
  supplierName?: string | null;
  deliveryNoteNumber?: string | null;
  deliveryNoteDate?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  lines: ReceiptLineInput[];
  userId?: number | null;
  userName?: string | null;
}) {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new ReceiptError("RECEIPT_NO_LINES", "يجب إضافة بند واحد على الأقل.", 400);
  }
  const ids = input.lines.map((line) => Number(line.itemId)).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (ids.length !== input.lines.length) {
    throw new ReceiptError("RECEIPT_INVALID_LINE", "بيانات بند غير صحيحة (الصنف مطلوب).", 400);
  }
  const items = await db
    .select({ id: itemsTable.id, code: itemsTable.code, name: itemsTable.name, unit: itemsTable.unit })
    .from(itemsTable);
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const line of input.lines) {
    if (!byId.has(Number(line.itemId))) {
      throw new ReceiptError("RECEIPT_UNKNOWN_ITEM", "أحد الأصناف في السند غير موجود.", 400);
    }
  }
  const code = (await nextDocumentNumber("GRN")) ?? `GRN-${Date.now()}`;

  const receiptId = await db.transaction(async (tx) => {
    const [receipt] = await tx
      .insert(receiptsTable)
      .values({
        code,
        status: "draft",
        warehouseId: input.warehouseId,
        supplierName: input.supplierName ?? null,
        deliveryNoteNumber: input.deliveryNoteNumber ?? null,
        deliveryNoteDate: input.deliveryNoteDate ?? null,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
        createdByUserId: input.userId ?? null,
        createdByName: input.userName ?? null,
        linesCount: input.lines.length,
      })
      .returning();
    await tx.insert(receiptLinesTable).values(
      input.lines.map((line) => {
        const item = byId.get(Number(line.itemId))!;
        return {
          receiptId: receipt.id,
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          unit: item.unit,
          orderedQuantity: Math.max(0, Math.trunc(Number(line.orderedQuantity ?? 0))),
          unitCost: line.unitCost === undefined || line.unitCost === null ? null : Math.round(Number(line.unitCost) * 100) / 100,
          receivedQuantity: Math.max(0, Math.trunc(Number(line.receivedQuantity ?? 0))),
          rejectedQuantity: Math.max(0, Math.trunc(Number(line.rejectedQuantity ?? 0))),
          rejectionReason: line.rejectionReason ? String(line.rejectionReason).trim() : null,
          batchNumber: line.batchNumber ? String(line.batchNumber).trim() : null,
          expiryDate: line.expiryDate ? String(line.expiryDate).trim() : null,
          inspectionNotes: line.inspectionNotes ? String(line.inspectionNotes).trim() : null,
        };
      }),
    );
    return receipt.id;
  });

  return getReceipt(receiptId);
}

export async function listReceipts(limit = 100) {
  return db
    .select()
    .from(receiptsTable)
    .orderBy(desc(receiptsTable.createdAt))
    .limit(Math.min(500, Math.max(1, limit)));
}

export async function getReceipt(id: number) {
  const [receipt] = await db.select().from(receiptsTable).where(eq(receiptsTable.id, id)).limit(1);
  if (!receipt) throw new ReceiptError("RECEIPT_NOT_FOUND", "سند الاستلام غير موجود.", 404);
  const lines = await db
    .select()
    .from(receiptLinesTable)
    .where(eq(receiptLinesTable.receiptId, id))
    .orderBy(asc(receiptLinesTable.id));
  return { ...receipt, lines };
}

/** Posting turns accepted quantities into inbound movements. */
export async function postReceipt(
  id: number,
  context: MovementContext,
  user: { id?: number | null; fullName?: string | null } | null,
) {
  const receipt = await getReceipt(id);
  if (receipt.status !== "draft") {
    throw new ReceiptError("RECEIPT_NOT_DRAFT", "لا يمكن ترحيل سند غير مسودة.", 409);
  }
  const accepted = receipt.lines.filter((line) => Number(line.receivedQuantity) > 0);
  if (accepted.length === 0) {
    throw new ReceiptError("RECEIPT_NOTHING_ACCEPTED", "لا توجد كميات مقبولة للترحيل.", 409);
  }
  const missingRejectionReason = receipt.lines.find(
    (line) => Number(line.rejectedQuantity) > 0 && !String(line.rejectionReason ?? "").trim(),
  );
  if (missingRejectionReason) {
    throw new ReceiptError(
      "RECEIPT_REJECTION_REASON_REQUIRED",
      `يجب تسجيل سبب الرفض (الصنف: ${missingRejectionReason.itemName}).`,
      409,
    );
  }

  let receivedTotal = 0;
  for (const line of accepted) {
    const quantity = Number(line.receivedQuantity);
    receivedTotal += quantity;
    await createInventoryMovement(
      {
        kind: "in",
        itemType: "item",
        itemId: line.itemId,
        quantity,
        supplySource: "central_warehouses",
        deliveryNoteNumber: receipt.deliveryNoteNumber ?? receipt.code,
        deliveryNoteDate: receipt.deliveryNoteDate ?? new Date().toISOString().slice(0, 10),
        documentDate: receipt.deliveryNoteDate ?? new Date().toISOString().slice(0, 10),
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        unitCost: line.unitCost ?? undefined,
        notes: `استلام بموجب ${receipt.code}${receipt.supplierName ? ` من ${receipt.supplierName}` : ""}`,
        warehouseId: receipt.warehouseId,
      } as never,
      context,
    );
  }

  const rejectedTotal = receipt.lines.reduce((sum, line) => sum + Number(line.rejectedQuantity ?? 0), 0);
  const [updated] = await db
    .update(receiptsTable)
    .set({
      status: "posted",
      postedAt: new Date(),
      postedByUserId: user?.id ?? null,
      postedByName: user?.fullName ?? null,
      receivedTotal,
      rejectedTotal,
      updatedAt: new Date(),
    })
    .where(eq(receiptsTable.id, id))
    .returning();
  return { receipt: { ...updated, lines: receipt.lines }, receivedTotal, rejectedTotal };
}

export async function cancelReceipt(id: number) {
  const receipt = await getReceipt(id);
  if (receipt.status !== "draft") {
    throw new ReceiptError("RECEIPT_NOT_DRAFT", "لا يمكن إلغاء سند مُرحّل.", 409);
  }
  const [updated] = await db
    .update(receiptsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(receiptsTable.id, id))
    .returning();
  return updated;
}

/** Receiving performance per supplier (report). */
export async function receiptSummary() {
  const rows = await db
    .select({
      supplierName: receiptsTable.supplierName,
      receipts: sql<number>`count(*)`,
      received: sql<number>`coalesce(sum(${receiptsTable.receivedTotal}), 0)`,
      rejected: sql<number>`coalesce(sum(${receiptsTable.rejectedTotal}), 0)`,
    })
    .from(receiptsTable)
    .where(and(eq(receiptsTable.status, "posted")))
    .groupBy(receiptsTable.supplierName)
    .orderBy(asc(receiptsTable.supplierName));
  return rows.map((row) => ({
    supplierName: row.supplierName ?? "غير محدد",
    receipts: Number(row.receipts ?? 0),
    received: Number(row.received ?? 0),
    rejected: Number(row.rejected ?? 0),
    rejectRate: Number(row.received ?? 0) + Number(row.rejected ?? 0) > 0
      ? Math.round((Number(row.rejected ?? 0) / (Number(row.received ?? 0) + Number(row.rejected ?? 0))) * 1000) / 10
      : null,
  }));
}
