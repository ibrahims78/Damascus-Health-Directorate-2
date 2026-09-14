/**
 * sync-apply-service.ts — Business-state materialization for the sync engine.
 *
 * The sync engine captures every business write into sync_change_log (with
 * version vectors, operation ids and per-origin sequences). This service
 * closes the loop: it applies incoming change payloads to the local business
 * tables, mapping global entity ids to local ids and surfacing conflicts.
 *
 * Design (approved 27-08-2026):
 *  - Two-pass materialization: pass 1 = reference entities (category, item,
 *    equipment, batch, ...), pass 2 = transaction bundles (transaction row +
 *    stock/quantity/custody effects).
 *  - Every change payload is a full row snapshot (captured after the write),
 *    so a missing base row on the receiver is recovered by insert.
 *  - Foreign keys carried as global-id refs are resolved to local ids;
 *    unresolvable references are recorded as conflicts (not silently dropped).
 *  - Users never receive password hashes; new users get a random unusable
 *    password and admins reset it locally.
 */

import { and, desc, eq, ne, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  db,
  categoriesTable,
  unitsTable,
  warehousesTable,
  transfersTable,
  itemsTable,
  equipmentTable,
  transactionsTable,
  recipientsTable,
  exitReasonsTable,
  usersTable,
  inventoryBatchesTable,
  transactionBatchAllocationsTable,
  personalCustodiesTable,
  custodyReturnsTable,
  damageRecordsTable,
  centralReturnsTable,
  syncEntityIdsTable,
  syncChangeLogTable,
  syncConflictTable,
} from "@workspace/db";
import type { SyncChange } from "./sync-service";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ────────────────────────────────────────────────────────────────────────── */

export function classifyConflictSeverity(
  conflictCode: string,
): "low" | "medium" | "high" | "critical" {
  if (conflictCode.includes("BALANCE") || conflictCode.includes("CUSTODY"))
    return "critical";
  if (conflictCode.includes("DELETE") || conflictCode.includes("DOCUMENT"))
    return "high";
  if (conflictCode.includes("PAYLOAD") || conflictCode.includes("REVISION"))
    return "medium";
  if (conflictCode.includes("REFERENCE") || conflictCode.includes("BASE"))
    return "high";
  return "low";
}

/** Column allowlists per synced table (id is always excluded). */
const TABLE_REGISTRY: Record<
  string,
  {
    table: unknown;
    columns: string[];
    softDelete?: boolean;
    tolerantRefs?: string[];
    refs?: Record<string, string>; // column -> ref key in the row carrying the global id
  }
> = {
  category: {
    table: categoriesTable,
    columns: ["name", "type", "createdAt"],
  },
  transfer: {
    table: transfersTable,
    columns: ["code", "status", "fromWarehouseId", "toWarehouseId", "requestedByUserId", "requestedByName", "notes", "deliveryNoteNumber", "provisional", "rejectionReason", "issuedAt", "receivedAt", "closedAt", "createdAt", "updatedAt"],
  },
  warehouse: {
    table: warehousesTable,
    columns: ["code", "name", "type", "isActive", "notes", "createdAt", "updatedAt"],
    softDelete: true,
  },
  unit: {
    table: unitsTable,
    columns: ["name", "symbol", "isActive", "isSystem", "sortOrder", "createdAt", "updatedAt"],
    softDelete: true,
  },
  item: {
    table: itemsTable,
    columns: [
      "code", "name", "categoryId", "itemType", "unit", "currentStock",
      "minStock", "expiryDate", "batchNumber", "location", "supplier",
      "notes", "isActive", "createdAt", "updatedAt",
    ],
    softDelete: true,
    refs: { categoryId: "categoryGlobalId" },
    // Pre-sync categories have no global mapping yet; keep the item and drop
    // the FK rather than failing the whole change.
    tolerantRefs: ["categoryId"],
  },
  equipment: {
    table: equipmentTable,
    columns: [
      "code", "name", "equipmentType", "model", "serialNumber", "condition",
      "manufactureYear", "originCountry", "currentHolder", "notes",
      "warehouseId", "quantity", "minQuantity", "maintenanceSentAt", "maintenanceReturnedAt",
      "maintenanceNotes", "isActive", "createdAt", "updatedAt",
    ],
    softDelete: true,
  },
  recipient: {
    table: recipientsTable,
    columns: ["name", "notes", "isActive", "createdAt"],
    softDelete: true,
  },
  exit_reason: {
    table: exitReasonsTable,
    columns: ["name", "isSystem", "isActive", "createdAt"],
    softDelete: true,
  },
  inventory_batch: {
    table: inventoryBatchesTable,
    columns: [
      "itemId", "warehouseId", "batchNumber", "receivedQuantity", "remainingQuantity",
      "expiryDate", "deliveryNoteNumber", "deliveryNoteDate", "supplySource",
      "sourceTransactionId", "createdAt", "updatedAt",
    ],
    refs: {
      itemId: "itemGlobalId",
      sourceTransactionId: "transactionGlobalId",
    },
    // A batch may reference a movement that has not arrived yet; the batch
    // row itself (remaining quantity) must still converge.
    tolerantRefs: ["sourceTransactionId"],
  },
  batch_allocation: {
    table: transactionBatchAllocationsTable,
    columns: [
      "transactionId", "batchId", "quantity", "batchNumberSnap",
      "expiryDateSnap", "createdAt",
    ],
    refs: { transactionId: "transactionGlobalId", batchId: "batchGlobalId" },
  },
  personal_custody: {
    table: personalCustodiesTable,
    columns: [
      "equipmentId", "sourceTransactionId", "recipientId", "holderNameSnap",
      "deliveryNoteNumber", "deliveryDate", "quantity", "returnedQuantity",
      "location", "status", "createdBy", "createdAt", "updatedAt",
    ],
    refs: {
      equipmentId: "equipmentGlobalId",
      sourceTransactionId: "transactionGlobalId",
    },
  },
  custody_return: {
    table: custodyReturnsTable,
    columns: [
      "custodyId", "transactionId", "quantity", "returnDate", "documentNumber",
      "condition", "returnedToLocation", "inspectionNotes", "createdBy",
      "createdAt",
    ],
    refs: { custodyId: "custodyGlobalId", transactionId: "transactionGlobalId" },
  },
  damage_record: {
    table: damageRecordsTable,
    columns: [
      "transactionId", "itemType", "itemId", "equipmentId", "quantity",
      "reason", "damageDate", "documentNumber", "serialNumberSnap", "notes",
      "createdBy", "createdAt",
    ],
    refs: {
      transactionId: "transactionGlobalId",
      itemId: "itemGlobalId",
      equipmentId: "equipmentGlobalId",
    },
  },
  central_return: {
    table: centralReturnsTable,
    columns: [
      "transactionId", "itemType", "itemId", "equipmentId", "quantity",
      "returnDate", "documentNumber", "receivingPartySnap", "condition",
      "reason", "notes", "createdBy", "createdAt",
    ],
    refs: {
      transactionId: "transactionGlobalId",
      itemId: "itemGlobalId",
      equipmentId: "equipmentGlobalId",
    },
  },
  user: {
    table: usersTable,
    columns: ["username", "fullName", "role", "isActive", "createdAt"],
  },
};

export type MaterializeResult = {
  applied: number;
  conflicts: Array<{ changeId: string; code: string; message: string }>;
  skipped: number;
};

class MaterializeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function resolveGlobalId(
  tx: DbTx,
  entityType: string,
  globalId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ localId: syncEntityIdsTable.localId })
    .from(syncEntityIdsTable)
    .where(
      and(
        eq(syncEntityIdsTable.entityType, entityType),
        eq(syncEntityIdsTable.globalId, globalId),
      ),
    )
    .limit(1);
  return row?.localId ?? null;
}

async function ensureLocalMapping(
  tx: DbTx,
  entityType: string,
  globalId: string,
  localId: number,
) {
  const existing = await resolveGlobalId(tx, entityType, globalId);
  if (existing === localId) return;
  await tx
    .insert(syncEntityIdsTable)
    .values({ entityType, globalId, localId })
    .onConflictDoNothing();
}

const DATE_COLUMN_HINT = /(At|Date)$/;

// `date(...)` columns that happen to end with "At" (equipment maintenance
// fields) — drizzle maps them in string mode, so they must stay strings.
const DATE_STRING_COLUMNS = new Set(["maintenanceSentAt", "maintenanceReturnedAt"]);

function normalizeDateValues(column: string, value: unknown): unknown {
  // Canonical payload form is ISO/date strings (jsonb round-trip). Convert to
  // the mode each drizzle column expects:
  //   - timestamptz columns (*At, e.g. createdAt/updatedAt/receivedAt) want
  //     Date objects (drizzle serializes via toISOString; strings crash);
  //   - date columns (*Date) want plain strings (a raw Date object gets
  //     toString()-ed by the PGlite binding → invalid SQL).
  if (value instanceof Date) {
    return DATE_STRING_COLUMNS.has(column) ? value.toISOString() : value;
  }
  if (typeof value === "string" && /At$/.test(column) && !DATE_STRING_COLUMNS.has(column)) {
    return new Date(value);
  }
  return value;
}

function pickColumns(
  registry: (typeof TABLE_REGISTRY)[string],
  row: Record<string, unknown>,
) {
  const out: Record<string, unknown> = {};
  for (const column of registry.columns) {
    if (row[column] !== undefined) {
      out[column] = normalizeDateValues(column, row[column]);
    }
  }
  return out;
}

function entityTypeForColumn(column: string): string {
  switch (column) {
    case "itemId": return "item";
    case "equipmentId": return "equipment";
    case "categoryId": return "category";
    case "batchId": return "inventory_batch";
    case "custodyId": return "personal_custody";
    case "transactionId":
    case "sourceTransactionId": return "transaction";
    case "recipientId": return "recipient";
    case "exitReasonId": return "exit_reason";
    default: return column;
  }
}

/** Strip global-id carrier keys from a row before persisting. */
function stripGlobalIdKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith("GlobalId")) continue;
    out[key] = value;
  }
  return out;
}

async function resolveRefs(
  tx: DbTx,
  row: Record<string, unknown>,
  refs: Record<string, string> | undefined,
  tolerant: string[] = [],
): Promise<Record<string, unknown>> {
  if (!refs) return row;
  const resolved = { ...row };
  for (const [column, refKey] of Object.entries(refs)) {
    const globalId = row[refKey] as string | undefined;
    if (!globalId) {
      // No ref captured — drop the local-id FK column rather than guessing.
      delete resolved[column];
      continue;
    }
    const localId = await resolveGlobalId(tx, entityTypeForColumn(column), globalId);
    if (localId === null) {
      if (tolerant.includes(column)) {
        delete resolved[column];
        continue;
      }
      throw new MaterializeError(
        "MISSING_REFERENCE",
        `المرجع غير موجود محلياً: ${column} (${globalId.slice(0, 8)}…)`,
      );
    }
    resolved[column] = localId;
  }
  return resolved;
}

async function upsertRow(
  tx: DbTx,
  entityType: string,
  globalId: string,
  changeType: string,
  row: Record<string, unknown>,
  refsOverride?: Record<string, string>,
  opts?: { viaMovement?: boolean },
): Promise<{ localId: number; created: boolean }> {
  const registry = TABLE_REGISTRY[entityType];
  if (!registry) {
    throw new MaterializeError("UNKNOWN_ENTITY_TYPE", `نوع كيان غير معروف: ${entityType}`);
  }
  if (entityType === "user") {
    return upsertUser(tx, globalId, changeType, row);
  }
  const existing = await resolveGlobalId(tx, entityType, globalId);
  const table = registry.table as never;

  if (changeType === "delete") {
    if (existing === null) return { localId: 0, created: false };
    if (registry.softDelete) {
      await tx
        .update(table)
        .set({ isActive: false, updatedAt: new Date() } as never)
        .where(eq((table as { id: unknown }).id as never, existing as never));
    } else {
      await tx
        .delete(table)
        .where(eq((table as { id: unknown }).id as never, existing as never));
    }
    return { localId: existing, created: false };
  }

  const resolved = await resolveRefs(
    tx,
    row,
    refsOverride ?? registry.refs,
    registry.tolerantRefs ?? [],
  );
  const cleaned = stripGlobalIdKeys(resolved);
  const values = pickColumns(registry, cleaned);

  if (existing !== null) {
    // Legacy-client guard (approved plan decision 3.2): a STANDALONE
    // equipment update that changes quantity did not travel as a documented
    // movement — reject it explicitly so the "no balance change without a
    // movement" invariant holds even for old distributed clients. Updates
    // that arrived as movement-sanctioned effects (viaMovement) and
    // first-time inserts are exempt.
    if (
      entityType === "equipment" &&
      !opts?.viaMovement &&
      changeType === "update" &&
      values.quantity !== undefined &&
      values.quantity !== null
    ) {
      const [local] = await tx
        .select({ quantity: equipmentTable.quantity })
        .from(equipmentTable)
        .where(eq(equipmentTable.id, existing as number));
      if (local && Number(local.quantity) !== Number(values.quantity)) {
        throw new MaterializeError(
          "LEGACY_EQUIPMENT_QUANTITY_REJECTED",
          "تعديل كمية التجهيز من إصدار قديم غير مقبول؛ استخدم تسوية الجرد من الإصدار الجديد",
        );
      }
    }
    await tx
      .update(table)
      .set(values as never)
      .where(eq((table as { id: unknown }).id as never, existing as never));
    return { localId: existing, created: false };
  }

  // create (or correction on missing base) → fresh local id
  const insertValues: Record<string, unknown> = { ...values };
  if (insertValues.isActive === undefined) insertValues.isActive = true;
  const insertedRows = await (
    tx.insert(table as never) as never as {
      values: (v: Record<string, unknown>) => {
        returning: () => Promise<Array<{ id: number }>>;
      };
    }
  )
    .values(insertValues)
    .returning();
  const [inserted] = insertedRows;
  if (!inserted) throw new MaterializeError("INSERT_FAILED", `تعذر إدراج ${entityType}`);
  await ensureLocalMapping(tx, entityType, globalId, inserted.id);
  return { localId: inserted.id, created: true };
}

async function upsertUser(
  tx: DbTx,
  globalId: string,
  changeType: string,
  row: Record<string, unknown>,
) {
  const existing = await resolveGlobalId(tx, "user", globalId);
  const values: Record<string, unknown> = {};
  for (const column of TABLE_REGISTRY.user.columns) {
    if (row[column] !== undefined) values[column] = row[column];
  }
  if (changeType === "delete") {
    if (existing !== null) {
      await tx
        .update(usersTable)
        .set({ isActive: false })
        .where(eq(usersTable.id, existing));
    }
    return { localId: existing ?? 0, created: false };
  }
  if (existing !== null) {
    // Never touch passwordHash on update.
    const safe: Record<string, unknown> = {};
    for (const key of ["fullName", "role", "isActive"]) {
      if (values[key] !== undefined) safe[key] = values[key];
    }
    await tx
      .update(usersTable)
      .set(safe as never)
      .where(eq(usersTable.id, existing));
    return { localId: existing, created: false };
  }
  const insertValues = {
    username: String(values.username ?? `sync-${globalId.slice(0, 8)}`),
    passwordHash: await bcrypt.hash(
      `sync-${crypto.randomUUID()}-${Date.now()}`,
      10,
    ),
    fullName: String(values.fullName ?? "مستخدم مُزامَن"),
    role: ((values.role as string) ?? "viewer") as
      | "admin"
      | "warehouse_manager"
      | "viewer",
    isActive: values.isActive !== false,
  };
  const [inserted] = await tx
    .insert(usersTable)
    .values(insertValues)
    .returning({ id: usersTable.id });
  await ensureLocalMapping(tx, "user", globalId, inserted.id);
  return { localId: inserted.id, created: true };
}

/* ── Transaction bundles ─────────────────────────────────────────────────── */

type BundleEffect = {
  entityType: string;
  entityGlobalId: string;
  changeType: string;
  row: Record<string, unknown>;
};

const TX_COLUMNS = [
  "operationId", "originNodeId", "originSequence", "documentNumberScope",
  "type", "itemType", "itemId", "equipmentId", "quantity", "recipientId",
  "recipientNameSnap", "recipientPerson", "exitReasonId", "exitReasonSnap",
  "documentNumber", "documentDate", "deliveryNoteNumber", "deliveryNoteDate",
  "supplySource", "expiryDate", "batchNumber", "internalDeliveryNoteNumber",
  "internalDeliveryNoteDate", "deliveryDestination", "custodyHolderNameSnap",
  "custodyNoteNumber", "custodyDate", "custodyLocation", "custodyStatus",
  "returnCondition", "reason", "isHistoricalIncomplete", "details", "notes",
  "createdBy", "createdAt",
];

async function materializeTransactionBundle(
  tx: DbTx,
  change: SyncChange,
  contextUserId: number | null,
) {
  const payload = (change.payload ?? {}) as {
    transaction?: Record<string, unknown>;
    effects?: BundleEffect[];
  };
  const txRow = payload.transaction ?? {};
  const transactionGlobalId = change.entityGlobalId;

  const resolved = { ...txRow };
  const itemGlobalId = txRow.itemGlobalId as string | undefined;
  const equipmentGlobalId = txRow.equipmentGlobalId as string | undefined;
  if (itemGlobalId) {
    const localItem = await resolveGlobalId(tx, "item", itemGlobalId);
    if (localItem === null) {
      throw new MaterializeError(
        "MISSING_REFERENCE",
        `المادة المرجعية للحركة غير موجودة محلياً (${itemGlobalId.slice(0, 8)}…)`,
      );
    }
    resolved.itemId = localItem;
  } else {
    delete resolved.itemId;
  }
  if (equipmentGlobalId) {
    const localEquipment = await resolveGlobalId(tx, "equipment", equipmentGlobalId);
    if (localEquipment === null) {
      throw new MaterializeError(
        "MISSING_REFERENCE",
        `التجهيز المرجعي للحركة غير موجود محلياً (${equipmentGlobalId.slice(0, 8)}…)`,
      );
    }
    resolved.equipmentId = localEquipment;
  } else {
    delete resolved.equipmentId;
  }
  // Recipients / exit reasons / users are not synced; snap columns carry the
  // business meaning, and local FKs are attributed to the acting admin.
  delete resolved.recipientId;
  delete resolved.exitReasonId;
  resolved.createdBy = contextUserId ?? null;

  const values: Record<string, unknown> = {};
  for (const column of TX_COLUMNS) {
    if (resolved[column] !== undefined) {
      values[column] = normalizeDateValues(column, resolved[column]);
    }
  }
  delete values.itemGlobalId;
  delete values.equipmentGlobalId;

  const existing = await resolveGlobalId(tx, "transaction", transactionGlobalId);
  let localTransactionId: number;
  if (existing !== null) {
    await tx
      .update(transactionsTable)
      .set(values as never)
      .where(eq(transactionsTable.id, existing));
    localTransactionId = existing;
  } else {
    try {
      const [inserted] = await tx
        .insert(transactionsTable)
        .values(values as never)
        .returning({ id: transactionsTable.id });
      localTransactionId = inserted.id;
    } catch (error) {
      // document_number is globally unique; two nodes may generate the same
      // number (e.g. ADJ-2026-0001). Retry once with a deterministic suffix.
      // PGlite wraps the constraint violation in `error.cause`, so both
      // surfaces must be inspected.
      const rawMsg = error instanceof Error ? String(error.message) : "";
      const causeMsg =
        error instanceof Error && error.cause instanceof Error ? String(error.cause.message) : "";
      if (/unique|duplicate|23505/i.test(rawMsg) || /unique|duplicate|23505/i.test(causeMsg)) {
        // PGlite aborts the whole transaction on the first failed statement;
        // recover to the per-change savepoint BEFORE retrying, otherwise the
        // retry itself dies with "current transaction is aborted".
        await tx.execute(sql`ROLLBACK TO SAVEPOINT sync_change`);
        const originShort = String(change.originNodeId ?? "node").slice(0, 8);
        values.documentNumber = `${String(values.documentNumber)}-${originShort}`;
        try {
          const [inserted] = await tx
            .insert(transactionsTable)
            .values(values as never)
            .returning({ id: transactionsTable.id });
          localTransactionId = inserted.id;
        } catch (retryError) {
          console.error(
            `[sync] transaction insert retry failed for ${values.documentNumber}: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
          );
          throw retryError;
        }
      } else {
        console.error(
          `[sync] transaction insert failed for ${String(values.documentNumber ?? "?" )}: ${rawMsg} ${causeMsg ? `cause=${causeMsg}` : ""}`,
        );
        throw error;
      }
    }
    await ensureLocalMapping(tx, "transaction", transactionGlobalId, localTransactionId);
  }

  // Effects — ordered so batches land before allocations and custody rows
  // before their returns. FK references to the local transaction row resolve
  // through the transaction global id mapping created above.
  const rank: Record<string, number> = {
    inventory_batch: 0,
    batch_allocation: 1,
    item: 2,
    equipment: 2,
    personal_custody: 3,
    custody_return: 4,
    damage_record: 4,
    central_return: 4,
  };
  const orderedEffects = [...(payload.effects ?? [])].sort(
    (a, b) => (rank[a.entityType] ?? 5) - (rank[b.entityType] ?? 5),
  );

  // Concurrent-adjustment policy (approved plan phase 8): when an incoming
  // `adjust` movement for equipment lands on a local quantity that diverged
  // from the movement's assumed starting point, the temporally newest
  // adjustment wins and the divergence is RECORDED — never a silent
  // replacement. A stale incoming adjustment keeps the local quantity.
  if (resolved.type === "adjust" && equipmentGlobalId) {
    const equipmentEffect = (payload.effects ?? []).find(
      (effect) => effect.entityType === "equipment",
    );
    if (equipmentEffect) {
      const localEquipment = await resolveGlobalId(tx, "equipment", equipmentGlobalId);
      if (localEquipment !== null) {
        const details = (txRow.details ?? null) as
          | { previousStock?: unknown; newStock?: unknown }
          | null;
        const [localEq] = await tx
          .select({ quantity: equipmentTable.quantity })
          .from(equipmentTable)
          .where(eq(equipmentTable.id, localEquipment));
        const previousStock =
          details?.previousStock === undefined || details?.previousStock === null
            ? null
            : Number(details.previousStock);
        if (
          localEq &&
          previousStock !== null &&
          Number.isFinite(previousStock) &&
          Number(localEq.quantity) !== previousStock
        ) {
          const [localLast] = await tx
            .select({
              createdAt: transactionsTable.createdAt,
              documentNumber: transactionsTable.documentNumber,
            })
            .from(transactionsTable)
            .where(
              and(
                eq(transactionsTable.equipmentId, localEquipment),
                eq(transactionsTable.type, "adjust"),
                ne(transactionsTable.id, localTransactionId),
              ),
            )
            .orderBy(desc(transactionsTable.createdAt), desc(transactionsTable.id))
            .limit(1);
          const incomingAt =
            values.createdAt instanceof Date
              ? values.createdAt.getTime()
              : new Date(String(values.createdAt ?? 0)).getTime() || 0;
          const localAt = localLast?.createdAt
            ? new Date(localLast.createdAt).getTime()
            : 0;
          const winner = incomingAt >= localAt ? "incoming" : "local";
          if (winner === "local") {
            // Keep the newer local quantity; the rest of the snapshot still
            // applies (metadata corrections travel with the movement).
            equipmentEffect.row = {
              ...equipmentEffect.row,
              quantity: Number(localEq.quantity),
            };
          }
          await tx
            .insert(syncConflictTable)
            .values({
              changeId: change.changeId,
              conflictCode: "CONCURRENT_ADJUSTMENT",
              severity: "medium",
              details: {
                equipmentGlobalId,
                localQuantityAtApply: Number(localEq.quantity),
                incomingPreviousStock: previousStock,
                incomingNewStock: details?.newStock ?? null,
                incomingDocumentNumber: String(values.documentNumber ?? ""),
                localLastAdjustDocument: localLast?.documentNumber ?? null,
                winner,
              },
            })
            .onConflictDoNothing();
        }
      }
    }
  }

  for (const effect of orderedEffects) {
    await upsertRow(
      tx,
      effect.entityType,
      effect.entityGlobalId,
      effect.changeType,
      effect.row,
      undefined,
      { viaMovement: true },
    );
  }

  return { localId: localTransactionId, created: existing === null };
}

/* ── Public entry points ─────────────────────────────────────────────────── */

export async function materializeSingleChange(
  tx: DbTx,
  change: SyncChange,
  contextUserId: number | null = null,
): Promise<void> {
  if (change.entityType === "transaction") {
    await materializeTransactionBundle(tx, change, contextUserId);
    return;
  }
  const row = (change.payload ?? {}) as Record<string, unknown>;
  await upsertRow(
    tx,
    change.entityType,
    change.entityGlobalId,
    change.changeType === "correction" ? "update" : change.changeType,
    row,
  );
}

/**
 * Materialize a batch of changes inside the caller's transaction.
 * Reference entities first, transaction bundles second, so FK dependencies
 * (item before its movements, batches before allocations) are satisfied.
 */
export async function materializeChanges(
  tx: DbTx,
  changes: SyncChange[],
  contextUserId: number | null = null,
): Promise<MaterializeResult> {
  const result: MaterializeResult = { applied: 0, conflicts: [], skipped: 0 };
  // Pass 1: reference entities. Pass 2: transactions first (they create the
  // transaction global-id mapping), then standalone batch/allocations whose
  // rows may reference a synced transaction.
  const pass1 = changes.filter(
    (change) =>
      change.entityType !== "transaction" &&
      change.entityType !== "inventory_batch" &&
      change.entityType !== "batch_allocation",
  );
  const pass2 = changes
    .filter(
      (change) =>
        change.entityType === "transaction" ||
        change.entityType === "inventory_batch" ||
        change.entityType === "batch_allocation",
    )
    .sort((a, b) => {
      const rank: Record<string, number> = {
        transaction: 0,
        inventory_batch: 1,
        batch_allocation: 2,
      };
      return (rank[a.entityType] ?? 3) - (rank[b.entityType] ?? 3);
    });

  const runPass = async (group: SyncChange[]) => {
    for (const change of group) {
      // A failed statement aborts the whole PGlite/PostgreSQL transaction;
      // each change therefore gets its own savepoint so a conflict in one
      // change never blocks the rest of the package.
      await tx.execute(sql`SAVEPOINT sync_change`);
      try {
        await materializeSingleChange(tx, change, contextUserId);
        await tx.execute(sql`RELEASE SAVEPOINT sync_change`);
        result.applied += 1;
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT sync_change`);
        const rawMessage = error instanceof Error ? error.message : "";
        const causeMessage =
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : "";
        const code =
          error instanceof MaterializeError
            ? error.code
            : /unique|duplicate|23505/i.test(rawMessage) || /unique|duplicate|23505/i.test(causeMessage)
              ? "UNIQUE_COLLISION"
              : "MATERIALIZE_FAILED";
        const message = error instanceof Error ? error.message : "خطأ أثناء تطبيق التغيير";
        result.conflicts.push({ changeId: change.changeId, code, message });
        // Persist the conflict so the UI can drive a decision.
        await tx
          .update(syncChangeLogTable)
          .set({ status: "conflict", rejectionCode: code, appliedAt: new Date() })
          .where(eq(syncChangeLogTable.changeId, change.changeId));
        await tx
          .insert(syncConflictTable)
          .values({
            changeId: change.changeId,
            conflictCode: code,
            severity: classifyConflictSeverity(code),
            details: { message, entityType: change.entityType },
          })
          .onConflictDoNothing();
      }
    }
  };

  await runPass(pass1);
  await runPass(pass2);
  return result;
}
