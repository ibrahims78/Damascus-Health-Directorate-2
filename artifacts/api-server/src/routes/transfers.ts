import { Router } from "express";
import { db, transfersTable, transferLinesTable, itemsTable, recipientsTable, exitReasonsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import {
  createInventoryMovementInTransaction,
  movementContextFromRequest,
} from "../lib/inventory-movement-service";
import { ensureNodeIdentity } from "../lib/sync-service";
import { getCurrentWarehouse, nextDocumentNumber } from "../lib/warehouse-service";
import { ensureSystemTransferCatalog, SYSTEM_TRANSFER_RECIPIENT, SYSTEM_TRANSFER_REASON } from "../lib/warehouse-service";

/**
 * Phase 6 - inter-warehouse transfer cycle.
 *
 * Offline-first: every step writes locally and immediately. Synchronisation
 * only *replicates* what already happened, it never gates an operation.
 * Statuses: requested -> issued -> received -> closed, plus rejected/cancelled.
 */
const router = Router();

const OPEN_STATUSES = ["requested", "issued"];

async function loadTransfer(id: number) {
  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, id)).limit(1);
  if (!transfer) return null;
  const lines = await db.select().from(transferLinesTable).where(eq(transferLinesTable.transferId, id));
  return { transfer, lines };
}

async function transferSummary(id: number) {
  const loaded = await loadTransfer(id);
  if (!loaded) return null;
  const itemIds = loaded.lines.map((l) => l.itemId);
  const items = itemIds.length
    ? await db.select({ id: itemsTable.id, code: itemsTable.code, name: itemsTable.name, unit: itemsTable.unit }).from(itemsTable).where(inArray(itemsTable.id, itemIds))
    : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    ...loaded.transfer,
    lines: loaded.lines.map((l) => ({ ...l, item: byId.get(l.itemId) ?? null })),
  };
}

// GET /api/transfers
router.get("/", requireAuth, async (req, res) => {
  try {
    const status = String(req.query.status ?? "").trim();
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100));
    const query = db.select().from(transfersTable);
    const rows = status
      ? await query.where(eq(transfersTable.status, status)).orderBy(desc(transfersTable.createdAt)).limit(limit)
      : await query.orderBy(desc(transfersTable.createdAt)).limit(limit);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/transfers/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "معرّف غير صالح." }); return; }
    const summary = await transferSummary(id);
    if (!summary) { res.status(404).json({ error: "التحويل غير موجود." }); return; }
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/transfers  { fromWarehouseId?, toWarehouseId?, items:[{itemId,quantity}], notes? }
router.post("/", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const current = await getCurrentWarehouse();
    if (!current) { res.status(409).json({ error: "لا يوجد مستودع مُهيّأ لهذا الجهاز.", code: "NO_WAREHOUSE" }); return; }
    const rawItems: unknown = req.body?.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(400).json({ error: "يجب تحديد صنف واحد على الأقل." });
      return;
    }
    const toWarehouseId = Number(req.body?.toWarehouseId ?? current.id);
    const fromWarehouseId = Number(req.body?.fromWarehouseId ?? current.id);
    if (toWarehouseId === fromWarehouseId) {
      res.status(400).json({ error: "لا يمكن التحويل إلى المستودع نفسه." });
      return;
    }
    const code = (await nextDocumentNumber("TRF")) ?? `TRF-${Date.now()}`;
    const created = await db.transaction(async (tx) => {
      const [transfer] = await tx
        .insert(transfersTable)
        .values({
          code,
          status: "requested",
          fromWarehouseId,
          toWarehouseId,
          requestedByUserId: res.locals.user?.id ?? null,
          requestedByName: res.locals.user?.fullName ?? null,
          notes: req.body?.notes ? String(req.body.notes).trim() : null,
        })
        .returning();
      for (const line of rawItems as Array<Record<string, unknown>>) {
        const itemId = Number(line?.itemId);
        const quantity = Number(line?.quantity);
        if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) {
          throw new Error("INVALID_LINE");
        }
        await tx.insert(transferLinesTable).values({
          transferId: transfer.id,
          itemId,
          quantity,
          unit: line?.unit ? String(line.unit) : null,
          batchNumber: line?.batchNumber ? String(line.batchNumber) : null,
          expiryDate: line?.expiryDate ? String(line.expiryDate) : null,
          notes: line?.notes ? String(line.notes) : null,
        });
      }
      return transfer;
    });
    await auditLog({ req, action: "create", entityType: "transfer", entityId: created.id, details: { code: created.code, toWarehouseId } });
    res.status(201).json(await transferSummary(created.id));
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_LINE") {
      res.status(400).json({ error: "سطر غير صالح: الصنف والكمية مطلوبان (أعداد صحيحة موجبة)." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/transfers/:id/issue  - the supplier site ships the goods
router.post("/:id/issue", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const loaded = await loadTransfer(id);
    if (!loaded) { res.status(404).json({ error: "التحويل غير موجود." }); return; }
    if (loaded.transfer.status !== "requested") {
      res.status(409).json({ error: `لا يمكن الإرسال من حالة «${loaded.transfer.status}».`, code: "INVALID_TRANSITION" });
      return;
    }
    await ensureSystemTransferCatalog();
    const [recipient] = await db.select().from(recipientsTable).where(eq(recipientsTable.name, SYSTEM_TRANSFER_RECIPIENT)).limit(1);
    const [reason] = await db.select().from(exitReasonsTable).where(eq(exitReasonsTable.name, SYSTEM_TRANSFER_REASON)).limit(1);
    const node = await ensureNodeIdentity("web");
    const context = movementContextFromRequest(req);
    const today = new Date().toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      for (const line of loaded.lines) {
        await createInventoryMovementInTransaction(
          tx,
          {
            kind: "out",
            itemType: "item",
            itemId: line.itemId,
            quantity: line.quantity,
            recipientId: recipient?.id ?? null,
            exitReasonId: reason?.id ?? null,
            documentDate: today,
            internalDeliveryNoteNumber: loaded.transfer.code,
            internalDeliveryNoteDate: today,
            deliveryDestination: "administrative_building",
            notes: `تحويل مخزني ${loaded.transfer.code}`,
            warehouseId: loaded.transfer.fromWarehouseId,
          },
          context,
          node,
        );
      }
      await tx
        .update(transfersTable)
        .set({ status: "issued", issuedAt: new Date(), updatedAt: new Date() })
        .where(eq(transfersTable.id, id));
    });
    await auditLog({ req, action: "issue", entityType: "transfer", entityId: id, details: { code: loaded.transfer.code } });
    res.json(await transferSummary(id));
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "";
    res.status(400).json({ error: message || "تعذّر إرسال التحويل.", code: "ISSUE_FAILED" });
  }
});

// POST /api/transfers/:id/receive  { deliveryNoteNumber?, provisional? }
router.post("/:id/receive", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const loaded = await loadTransfer(id);
    if (!loaded) { res.status(404).json({ error: "التحويل غير موجود." }); return; }
    const provisional = Boolean(req.body?.provisional);
    if (loaded.transfer.status !== "issued" && !provisional) {
      res.status(409).json({ error: `لا يمكن الاستلام قبل الإرسال.`, code: "INVALID_TRANSITION" });
      return;
    }
    if (loaded.transfer.status === "received" || loaded.transfer.status === "closed") {
      res.status(409).json({ error: "تم استلام هذا التحويل مسبقًا.", code: "ALREADY_RECEIVED" });
      return;
    }
    const node = await ensureNodeIdentity("web");
    const context = movementContextFromRequest(req);
    const today = new Date().toISOString().slice(0, 10);
    const deliveryNoteNumber = String(req.body?.deliveryNoteNumber ?? loaded.transfer.deliveryNoteNumber ?? loaded.transfer.code);

    const rawReceived = Array.isArray(req.body?.lines) ? (req.body.lines as Array<Record<string, unknown>>) : [];
    const receivedByLine = new Map<number, { quantity: number; reason: string | null }>();
    for (const entry of rawReceived) {
      const lineId = Number(entry?.lineId);
      if (!Number.isSafeInteger(lineId) || lineId <= 0) continue;
      const quantity = Number(entry?.receivedQuantity);
      if (!Number.isSafeInteger(quantity) || quantity < 0) continue;
      receivedByLine.set(lineId, {
        quantity,
        reason: entry?.varianceReason ? String(entry.varianceReason).trim() : null,
      });
    }

    await db.transaction(async (tx) => {
      for (const line of loaded.lines) {
        await createInventoryMovementInTransaction(
          tx,
          {
            kind: "in",
            itemType: "item",
            itemId: line.itemId,
            quantity: receivedByLine.get(line.id)?.quantity ?? line.quantity,
            supplySource: "central_warehouses",
            deliveryNoteNumber,
            deliveryNoteDate: today,
            documentDate: today,
            batchNumber: line.batchNumber ?? null,
            expiryDate: line.expiryDate ?? null,
            notes: `استلام تحويل ${loaded.transfer.code}`,
            warehouseId: loaded.transfer.toWarehouseId,
          },
          context,
          node,
        );
      }
      for (const line of loaded.lines) {
        const counted = receivedByLine.get(line.id);
        if (!counted) continue;
        await tx
          .update(transferLinesTable)
          .set({
            receivedQuantity: counted.quantity,
            variance: counted.quantity - Number(line.quantity),
            varianceReason: counted.reason,
          })
          .where(eq(transferLinesTable.id, line.id));
      }
      await tx
        .update(transfersTable)
        .set({
          status: "received",
          receivedAt: new Date(),
          closedAt: new Date(),
          deliveryNoteNumber,
          provisional,
          updatedAt: new Date(),
        })
        .where(eq(transfersTable.id, id));
    });
    await auditLog({ req, action: "receive", entityType: "transfer", entityId: id, details: { code: loaded.transfer.code, provisional, deliveryNoteNumber } });
    res.json(await transferSummary(id));
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "";
    res.status(400).json({ error: message || "تعذّر استلام التحويل.", code: "RECEIVE_FAILED" });
  }
});

// POST /api/transfers/:id/reject { reason }
router.post("/:id/reject", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const loaded = await loadTransfer(id);
    if (!loaded) { res.status(404).json({ error: "التحويل غير موجود." }); return; }
    if (!OPEN_STATUSES.includes(loaded.transfer.status)) {
      res.status(409).json({ error: "لا يمكن رفض تحويل منتهٍ.", code: "INVALID_TRANSITION" });
      return;
    }
    await db
      .update(transfersTable)
      .set({ status: "rejected", rejectionReason: req.body?.reason ? String(req.body.reason).trim() : null, updatedAt: new Date() })
      .where(eq(transfersTable.id, id));
    await auditLog({ req, action: "reject", entityType: "transfer", entityId: id, details: { code: loaded.transfer.code } });
    res.json(await transferSummary(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/transfers/:id/cancel
router.post("/:id/cancel", requireAuth, requireRole("admin", "warehouse_manager"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const loaded = await loadTransfer(id);
    if (!loaded) { res.status(404).json({ error: "التحويل غير موجود." }); return; }
    if (!OPEN_STATUSES.includes(loaded.transfer.status)) {
      res.status(409).json({ error: "لا يمكن إلغاء تحويل مكتمل.", code: "INVALID_TRANSITION" });
      return;
    }
    await db
      .update(transfersTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(transfersTable.id, id));
    await auditLog({ req, action: "cancel", entityType: "transfer", entityId: id, details: { code: loaded.transfer.code } });
    res.json(await transferSummary(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
