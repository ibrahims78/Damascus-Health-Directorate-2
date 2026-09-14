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
import { equipmentTable } from "./equipment";
import { transactionsTable } from "./transactions";
import { usersTable } from "./users";
import { personalCustodiesTable } from "./custodies";
import {
  type InventoryItemType,
  type ReturnCondition,
} from "./inventory-enums";

const entityReferenceChecks = (table: {
  itemType: unknown;
  itemId: unknown;
  equipmentId: unknown;
}) =>
  sql`(
    (${table.itemType} = 'item' AND ${table.itemId} IS NOT NULL AND ${table.equipmentId} IS NULL)
    OR
    (${table.itemType} = 'equipment' AND ${table.itemId} IS NULL AND ${table.equipmentId} IS NOT NULL)
  )`;

/**
 * Damage is a first-class record. The transaction link is required so a later
 * service layer can atomically create the event and its balance effect.
 */
export const damageRecordsTable = pgTable(
  "damage_records",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactionsTable.id),
    itemType: text("item_type")
      .notNull()
      .$type<InventoryItemType>(),
    itemId: integer("item_id").references(() => itemsTable.id),
    equipmentId: integer("equipment_id").references(() => equipmentTable.id),
    quantity: integer("quantity").notNull(),
    reason: text("reason").notNull(),
    damageDate: date("damage_date", { mode: "string" }).notNull(),
    documentNumber: text("document_number").notNull(),
    serialNumberSnap: text("serial_number_snap"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("damage_records_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "damage_records_item_type_valid",
      sql`${table.itemType} IN ('item', 'equipment')`
    ),
    check("damage_records_entity_reference_valid", entityReferenceChecks(table)),
    unique("damage_records_transaction_unique").on(table.transactionId),
    unique("damage_records_document_number_unique").on(table.documentNumber),
    index("damage_records_entity_idx").on(table.itemType, table.itemId, table.equipmentId),
    index("damage_records_damage_date_idx").on(table.damageDate),
  ]
);

export const insertDamageRecordSchema = createInsertSchema(damageRecordsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDamageRecord = z.infer<typeof insertDamageRecordSchema>;
export type DamageRecord = typeof damageRecordsTable.$inferSelect;

/**
 * A central return is intentionally not coupled to a personal custody return.
 * It has its own document and receiving-party snapshot.
 */
export const centralReturnsTable = pgTable(
  "central_returns",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactionsTable.id),
    itemType: text("item_type")
      .notNull()
      .$type<InventoryItemType>(),
    itemId: integer("item_id").references(() => itemsTable.id),
    equipmentId: integer("equipment_id").references(() => equipmentTable.id),
    quantity: integer("quantity").notNull(),
    returnDate: date("return_date", { mode: "string" }).notNull(),
    documentNumber: text("document_number").notNull(),
    receivingPartySnap: text("receiving_party_snap")
      .notNull()
      .default("central_warehouses"),
    condition: text("condition")
      .notNull()
      .$type<ReturnCondition>(),
    reason: text("reason").notNull(),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("central_returns_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "central_returns_item_type_valid",
      sql`${table.itemType} IN ('item', 'equipment')`
    ),
    check("central_returns_entity_reference_valid", entityReferenceChecks(table)),
    check(
      "central_returns_party_central",
      sql`${table.receivingPartySnap} = 'central_warehouses'`
    ),
    check(
      "central_returns_condition_valid",
      sql`${table.condition} IN ('good', 'damaged', 'needs_maintenance', 'missing')`
    ),
    unique("central_returns_transaction_unique").on(table.transactionId),
    unique("central_returns_document_number_unique").on(table.documentNumber),
    index("central_returns_entity_idx").on(table.itemType, table.itemId, table.equipmentId),
    index("central_returns_return_date_idx").on(table.returnDate),
  ]
);

export const insertCentralReturnSchema = createInsertSchema(centralReturnsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCentralReturn = z.infer<typeof insertCentralReturnSchema>;
export type CentralReturn = typeof centralReturnsTable.$inferSelect;

/**
 * Return of an existing personal custody. A unique transaction link prevents
 * one transaction from being represented twice in the return ledger.
 */
export const custodyReturnsTable = pgTable(
  "custody_returns",
  {
    id: serial("id").primaryKey(),
    custodyId: integer("custody_id")
      .notNull()
      .references(() => personalCustodiesTable.id),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactionsTable.id),
    quantity: integer("quantity").notNull(),
    returnDate: date("return_date", { mode: "string" }).notNull(),
    documentNumber: text("document_number").notNull(),
    condition: text("condition")
      .notNull()
      .$type<ReturnCondition>(),
    returnedToLocation: text("returned_to_location").notNull(),
    inspectionNotes: text("inspection_notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("custody_returns_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "custody_returns_condition_valid",
      sql`${table.condition} IN ('good', 'damaged', 'needs_maintenance', 'missing')`
    ),
    unique("custody_returns_transaction_unique").on(table.transactionId),
    unique("custody_returns_document_number_unique").on(table.documentNumber),
    index("custody_returns_custody_date_idx").on(table.custodyId, table.returnDate),
  ]
);

export const insertCustodyReturnSchema = createInsertSchema(custodyReturnsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCustodyReturn = z.infer<typeof insertCustodyReturnSchema>;
export type CustodyReturn = typeof custodyReturnsTable.$inferSelect;