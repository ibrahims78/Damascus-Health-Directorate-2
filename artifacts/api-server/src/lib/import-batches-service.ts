import { db, importBatchesTable, itemsTable, equipmentTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  ensureEntityIdentity,
  ensureNodeIdentity,
  recordLocalChange,
} from "./sync-service";

/**
 * Phase 3 - import governance service.
 * Journaling of committed imports + admin rollback (inverse operation).
 */

export type RollbackPayload = {
  createdItems?: number[];
  updatedItems?: Array<Record<string, unknown>>;
  createdEquipment?: number[];
  updatedEquipment?: Array<Record<string, unknown>>;
};

export async function recordImportBatch(input: {
  kind: "items" | "equipment";
  mode: "insert" | "upsert";
  fileName?: string | null;
  fileHash?: string | null;
  actorUserId?: number | null;
  actorName?: string | null;
  createdCount: number;
  updatedCount: number;
  skippedCount?: number;
  errorCount?: number;
  openingBatchCount?: number;
  summary?: unknown;
  rollback: RollbackPayload;
}) {
  const [row] = await db
    .insert(importBatchesTable)
    .values({
      kind: input.kind,
      mode: input.mode,
      fileName: input.fileName ?? null,
      fileHash: input.fileHash ?? null,
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName ?? null,
      createdCount: input.createdCount,
      updatedCount: input.updatedCount,
      skippedCount: input.skippedCount ?? 0,
      errorCount: input.errorCount ?? 0,
      openingBatchCount: input.openingBatchCount ?? 0,
      summary: (input.summary ?? null) as never,
      rollback: input.rollback as never,
    })
    .returning();
  return row;
}

export async function listImportBatches(limit = 100) {
  return db
    .select()
    .from(importBatchesTable)
    .orderBy(desc(importBatchesTable.createdAt))
    .limit(Math.min(500, Math.max(1, limit)));
}

export class RollbackError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/**
 * Roll a committed import back:
 *  - rows created by the import are archived (soft delete) so history stays intact
 *  - rows updated by the import are restored to their previous values
 *  - batches that created opening balances cannot be rolled back automatically
 */
export async function rollbackImportBatch(id: number, actorUserId?: number | null) {
  const [batch] = await db
    .select()
    .from(importBatchesTable)
    .where(eq(importBatchesTable.id, id))
    .limit(1);
  if (!batch) throw new RollbackError("IMPORT_BATCH_NOT_FOUND", "دفعة الاستيراد غير موجودة.", 404);
  if (batch.status === "rolled_back") {
    throw new RollbackError("IMPORT_BATCH_ALREADY_ROLLED_BACK", "تم التراجع عن هذه الدفعة مسبقًا.", 409);
  }
  if ((batch.openingBatchCount ?? 0) > 0) {
    throw new RollbackError(
      "IMPORT_BATCH_HAS_OPENING_BALANCES",
      "لا يمكن التراجع تلقائيًا عن دفعة أنشأت أرصدة افتتاحية. راجع الدفعات والحركات يدويًا.",
      409,
    );
  }

  const payload = (batch.rollback ?? {}) as RollbackPayload;
  const node = await ensureNodeIdentity("web");
  let archived = 0;
  let restored = 0;

  await db.transaction(async (tx) => {
    for (const itemId of payload.createdItems ?? []) {
      const [row] = await tx
        .update(itemsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(itemsTable.id, itemId))
        .returning();
      if (!row) continue;
      archived += 1;
      const globalId = await ensureEntityIdentity(tx, "item", row.id);
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: "item",
        localEntityId: row.id,
        globalId,
        changeType: "update",
        payload: { ...row },
      });
    }

    for (const entry of payload.updatedItems ?? []) {
      const before = entry as Record<string, unknown>;
      const itemId = Number(before.id);
      if (!Number.isSafeInteger(itemId)) continue;
      const [row] = await tx
        .update(itemsTable)
        .set({
          name: before.name as string,
          categoryId: (before.categoryId ?? null) as number | null,
          unit: before.unit as string,
          minStock: Number(before.minStock ?? 0),
          location: (before.location ?? null) as string | null,
          notes: (before.notes ?? null) as string | null,
          updatedAt: new Date(),
        })
        .where(eq(itemsTable.id, itemId))
        .returning();
      if (!row) continue;
      restored += 1;
      const globalId = await ensureEntityIdentity(tx, "item", row.id);
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: "item",
        localEntityId: row.id,
        globalId,
        changeType: "update",
        payload: { ...row },
      });
    }

    for (const equipmentId of payload.createdEquipment ?? []) {
      const [row] = await tx
        .update(equipmentTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(equipmentTable.id, equipmentId))
        .returning();
      if (!row) continue;
      archived += 1;
      const globalId = await ensureEntityIdentity(tx, "equipment", row.id);
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: "equipment",
        localEntityId: row.id,
        globalId,
        changeType: "update",
        payload: { ...row },
      });
    }

    for (const entry of payload.updatedEquipment ?? []) {
      const before = entry as Record<string, unknown>;
      const equipmentId = Number(before.id);
      if (!Number.isSafeInteger(equipmentId)) continue;
      const [row] = await tx
        .update(equipmentTable)
        .set({
          name: before.name as string,
          equipmentType: (before.equipmentType ?? null) as string | null,
          model: (before.model ?? null) as string | null,
          serialNumber: (before.serialNumber ?? null) as string | null,
          condition: before.condition as never,
          manufactureYear: (before.manufactureYear ?? null) as number | null,
          originCountry: (before.originCountry ?? null) as string | null,
          currentHolder: (before.currentHolder ?? null) as string | null,
          notes: (before.notes ?? null) as string | null,
          quantity: Number(before.quantity ?? 1),
          minQuantity: Number(before.minQuantity ?? 0),
          updatedAt: new Date(),
        })
        .where(eq(equipmentTable.id, equipmentId))
        .returning();
      if (!row) continue;
      restored += 1;
      const globalId = await ensureEntityIdentity(tx, "equipment", row.id);
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: "equipment",
        localEntityId: row.id,
        globalId,
        changeType: "update",
        payload: { ...row },
      });
    }

    await tx
      .update(importBatchesTable)
      .set({
        status: "rolled_back",
        rolledBackAt: new Date(),
        rolledBackByUserId: actorUserId ?? null,
      })
      .where(eq(importBatchesTable.id, id));
  });

  return { archived, restored };
}
