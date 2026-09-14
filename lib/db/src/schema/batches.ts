import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { itemsTable } from "./items";
import { transactionsTable } from "./transactions";
import { SUPPLY_SOURCES, type SupplySource } from "./inventory-enums";

/**
 * One physical/administrative batch of a consumable item.
 *
 * `remainingQuantity` is intentionally kept beside the receipt quantity so
 * FEFO allocations can be audited without reconstructing a batch from the
 * item-level stock only.
 */
export const inventoryBatchesTable = pgTable(
  "inventory_batches",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => itemsTable.id),
    batchNumber: text("batch_number"),
    receivedQuantity: integer("received_quantity").notNull(),
    remainingQuantity: integer("remaining_quantity").notNull(),
    expiryDate: date("expiry_date", { mode: "string" }),
    supplier: text("supplier"),
    deliveryNoteNumber: text("delivery_note_number"),
    deliveryNoteDate: date("delivery_note_date", { mode: "string" }),
    // Phase 5: the site holding this batch.
    warehouseId: integer("warehouse_id"),
    supplySource: text("supply_source")
      .notNull()
      .default(SUPPLY_SOURCES[0])
      .$type<SupplySource>(),
    sourceTransactionId: integer("source_transaction_id").references(
      () => transactionsTable.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "inventory_batches_received_positive",
      sql`${table.receivedQuantity} > 0`
    ),
    check(
      "inventory_batches_remaining_valid",
      sql`${table.remainingQuantity} >= 0 AND ${table.remainingQuantity} <= ${table.receivedQuantity}`
    ),
    check(
      "inventory_batches_supply_source_central",
      sql`${table.supplySource} = 'central_warehouses'`
    ),
    unique("inventory_batches_item_batch_expiry_note_unique").on(
      table.itemId,
      table.batchNumber,
      table.expiryDate,
      table.deliveryNoteNumber
    ),
    index("inventory_batches_item_expiry_idx").on(
      table.itemId,
      table.expiryDate
    ),
    index("inventory_batches_source_transaction_idx").on(
      table.sourceTransactionId
    ),
  ]
);

export const insertInventoryBatchSchema = createInsertSchema(
  inventoryBatchesTable
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInventoryBatch = z.infer<typeof insertInventoryBatchSchema>;
export type InventoryBatch = typeof inventoryBatchesTable.$inferSelect;