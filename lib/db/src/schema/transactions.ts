import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { itemsTable } from "./items";
import { equipmentTable } from "./equipment";
import { recipientsTable } from "./recipients";
import { exitReasonsTable } from "./exit_reasons";
import { usersTable } from "./users";
import {
  DELIVERY_DESTINATIONS,
  ITEM_TYPES,
  SUPPLY_SOURCES,
  TRANSACTION_TYPES,
  type DeliveryDestination,
  type InventoryItemType,
  type SupplySource,
  type TransactionType,
} from "./inventory-enums";

export const transactionsTable = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    operationId: text("operation_id").unique(),
    originNodeId: text("origin_node_id"),
    originSequence: integer("origin_sequence"),
    documentNumberScope: text("document_number_scope"),
    type: text("type")
      .notNull()
      .$type<TransactionType>(),
    itemType: text("item_type")
      .notNull()
      .$type<InventoryItemType>(),
    itemId: integer("item_id").references(() => itemsTable.id),
    equipmentId: integer("equipment_id").references(() => equipmentTable.id),
    quantity: integer("quantity"),
    recipientId: integer("recipient_id").references(() => recipientsTable.id),
    recipientNameSnap: text("recipient_name_snap"),
    recipientPerson: text("recipient_person"),
    exitReasonId: integer("exit_reason_id").references(() => exitReasonsTable.id),
    exitReasonSnap: text("exit_reason_snap"),
    documentNumber: text("document_number").notNull().unique(),
    // Phase 5: the site that owns this movement.
    warehouseId: integer("warehouse_id"),
    documentDate: date("document_date", { mode: "string" }),
    deliveryNoteNumber: text("delivery_note_number"),
    deliveryNoteDate: date("delivery_note_date", { mode: "string" }),
    supplySource: text("supply_source").$type<SupplySource>(),
    expiryDate: date("expiry_date", { mode: "string" }),
    batchNumber: text("batch_number"),
    internalDeliveryNoteNumber: text("internal_delivery_note_number"),
    internalDeliveryNoteDate: date("internal_delivery_note_date", { mode: "string" }),
    deliveryDestination: text("delivery_destination").$type<DeliveryDestination>(),
    custodyHolderNameSnap: text("custody_holder_name_snap"),
    custodyNoteNumber: text("custody_note_number"),
    custodyDate: date("custody_date", { mode: "string" }),
    custodyLocation: text("custody_location"),
    custodyStatus: text("custody_status"),
    returnCondition: text("return_condition"),
    reason: text("reason"),
    isHistoricalIncomplete: boolean("is_historical_incomplete")
      .notNull()
      .default(false),
    // Structured movement details (approved plan 3.1): stock before/after,
    // delta, and equipment snapshots for printable vouchers. JSONB keeps the
    // migration minimal and the shape extensible.
    details: jsonb("details"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
  reversalOfId: integer("reversal_of_id"),
  reversedById: integer("reversed_by_id"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  reversalReason: text("reversal_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "transactions_type_valid",
      sql`${table.type} IN ('in', 'out', 'init', 'adjust', 'custody_out', 'custody_return', 'damage', 'central_return')`
    ),
    check(
      "transactions_item_type_valid",
      sql`${table.itemType} IN ('item', 'equipment')`
    ),
    check(
      "transactions_quantity_positive",
      sql`${table.quantity} IS NULL OR ${table.quantity} > 0`
    ),
    check(
      "transactions_document_number_nonempty",
      sql`length(btrim(${table.documentNumber})) > 0`
    ),
    check(
      "transactions_supply_source_central",
      sql`${table.supplySource} IS NULL OR ${table.supplySource} = 'central_warehouses'`
    ),
    check(
      "transactions_delivery_destination_valid",
      sql`${table.deliveryDestination} IS NULL OR ${table.deliveryDestination} IN ('administrative_building', 'health_facility', 'ambulance_point')`
    ),
    index("transactions_created_at_idx").on(table.createdAt),
    index("transactions_document_date_idx").on(table.documentDate),
    index("transactions_type_item_idx").on(table.type, table.itemType),
    index("transactions_item_idx").on(table.itemId),
    index("transactions_equipment_idx").on(table.equipmentId),
  ]
);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
