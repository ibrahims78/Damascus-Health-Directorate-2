import {
  db,
  warehousesTable,
  systemSettingsTable,
  transactionsTable,
  inventoryBatchesTable,
  equipmentTable,
  recipientsTable,
  exitReasonsTable,
} from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";

export const SYSTEM_TRANSFER_RECIPIENT = "تحويل داخلي بين المستودعات";
export const SYSTEM_TRANSFER_REASON = "تحويل مخزني";

/**
 * Phase 6: the outbound leg of a transfer needs a recipient and an exit
 * reason. They are created once as system rows so the transfer flow does not
 * depend on an operator maintaining master data first.
 */
export async function ensureSystemTransferCatalog(): Promise<void> {
  const [recipient] = await db
    .select({ id: recipientsTable.id })
    .from(recipientsTable)
    .where(eq(recipientsTable.name, SYSTEM_TRANSFER_RECIPIENT))
    .limit(1);
  if (!recipient) {
    await db
      .insert(recipientsTable)
      .values({ name: SYSTEM_TRANSFER_RECIPIENT, notes: "سجل نظامي لتحويلات المخزون بين المستودعات" });
  }
  const [reason] = await db
    .select({ id: exitReasonsTable.id })
    .from(exitReasonsTable)
    .where(eq(exitReasonsTable.name, SYSTEM_TRANSFER_REASON))
    .limit(1);
  if (!reason) {
    await db
      .insert(exitReasonsTable)
      .values({ name: SYSTEM_TRANSFER_REASON, isSystem: true });
  }
}

/**
 * Phase 5 - warehouse service.
 *
 * Keeps the "current warehouse" of this installation (system_settings) in sync
 * with a real warehouse row, backfills the legacy rows that predate the
 * warehouse dimension, and issues globally-unique document numbers per site.
 */

export type CurrentWarehouse = { id: number; code: string; name: string; type: string };

export async function listWarehouses(includeArchived = false) {
  const query = db.select().from(warehousesTable);
  const rows = includeArchived
    ? await query.orderBy(asc(warehousesTable.type), asc(warehousesTable.name))
    : await query
        .where(eq(warehousesTable.isActive, true))
        .orderBy(asc(warehousesTable.type), asc(warehousesTable.name));
  return rows;
}

export async function getCurrentWarehouse(): Promise<CurrentWarehouse | null> {
  const [settings] = await db
    .select()
    .from(systemSettingsTable)
    .orderBy(asc(systemSettingsTable.id))
    .limit(1);
  if (settings?.warehouseId) {
    const [wh] = await db
      .select()
      .from(warehousesTable)
      .where(eq(warehousesTable.id, settings.warehouseId))
      .limit(1);
    if (wh) return { id: wh.id, code: wh.code, name: wh.name, type: wh.type };
  }
  const [central] = await db
    .select()
    .from(warehousesTable)
    .where(eq(warehousesTable.type, "central"))
    .limit(1);
  if (central) return { id: central.id, code: central.code, name: central.name, type: central.type };
  return null;
}

export async function setCurrentWarehouse(id: number): Promise<CurrentWarehouse> {
  const [wh] = await db.select().from(warehousesTable).where(eq(warehousesTable.id, id)).limit(1);
  if (!wh) throw new Error("WAREHOUSE_NOT_FOUND");
  const [settings] = await db
    .select()
    .from(systemSettingsTable)
    .orderBy(asc(systemSettingsTable.id))
    .limit(1);
  if (settings) {
    await db
      .update(systemSettingsTable)
      .set({ warehouseId: id, updatedAt: new Date() })
      .where(eq(systemSettingsTable.id, settings.id));
  } else {
    await db.insert(systemSettingsTable).values({ warehouseId: id });
  }
  return { id: wh.id, code: wh.code, name: wh.name, type: wh.type };
}

/** Creates the central warehouse on a fresh install and backfills legacy rows. */
export async function ensureDefaultWarehouse() {
  let central = (
    await db.select().from(warehousesTable).where(eq(warehousesTable.type, "central")).limit(1)
  )[0];
  let created = false;
  if (!central) {
    const anyWarehouse = await db.select({ id: warehousesTable.id }).from(warehousesTable).limit(1);
    if (anyWarehouse.length === 0) {
      central = (
        await db
          .insert(warehousesTable)
          .values({ code: "C", name: "المستودع الرئيسي", type: "central" })
          .returning()
      )[0];
      created = true;
    } else {
      central = (await db.select().from(warehousesTable).limit(1))[0];
    }
  }
  if (!central) return null;

  const [settings] = await db
    .select()
    .from(systemSettingsTable)
    .orderBy(asc(systemSettingsTable.id))
    .limit(1);
  if (settings && !settings.warehouseId) {
    await db
      .update(systemSettingsTable)
      .set({ warehouseId: central.id, updatedAt: new Date() })
      .where(eq(systemSettingsTable.id, settings.id));
  }

  await db
    .update(transactionsTable)
    .set({ warehouseId: central.id })
    .where(sql`${transactionsTable.warehouseId} IS NULL`);
  await db
    .update(inventoryBatchesTable)
    .set({ warehouseId: central.id })
    .where(sql`${inventoryBatchesTable.warehouseId} IS NULL`);
  await db
    .update(equipmentTable)
    .set({ warehouseId: central.id })
    .where(sql`${equipmentTable.warehouseId} IS NULL`);

  return { ...central, created };
}

/**
 * `CODE-TYPE-YEAR-NNNNNN` using an atomic per-warehouse counter, so numbers can
 * never collide after several sites are merged.
 */
export async function nextDocumentNumber(
  docType: string,
  year = new Date().getFullYear(),
): Promise<string | null> {
  const current = await getCurrentWarehouse();
  if (!current) return null;
  const res = await db.execute(sql`
    INSERT INTO document_sequences (warehouse_id, doc_type, year, last_number)
    VALUES (${current.id}, ${docType}, ${year}, 1)
    ON CONFLICT (warehouse_id, doc_type, year)
    DO UPDATE SET last_number = document_sequences.last_number + 1, updated_at = now()
    RETURNING last_number
  `);
  const n = Number((res.rows[0] as { last_number?: number } | undefined)?.last_number ?? 1);
  return `${current.code}-${docType}-${year}-${String(n).padStart(6, "0")}`;
}
