import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { equipmentTable } from "./equipment";
import { recipientsTable } from "./recipients";
import { transactionsTable } from "./transactions";
import { usersTable } from "./users";
import {
  CUSTODY_STATUSES,
  RETURN_CONDITIONS,
  type CustodyStatus,
  type ReturnCondition,
} from "./inventory-enums";

/**
 * A personal custody allocation is separate from the equipment master row.
 * This keeps holder, document, location, and lifecycle state auditable.
 */
export const personalCustodiesTable = pgTable(
  "personal_custodies",
  {
    id: serial("id").primaryKey(),
    equipmentId: integer("equipment_id")
      .notNull()
      .references(() => equipmentTable.id),
    sourceTransactionId: integer("source_transaction_id").references(
      () => transactionsTable.id
    ),
    recipientId: integer("recipient_id").references(() => recipientsTable.id),
    holderNameSnap: text("holder_name_snap").notNull(),
    deliveryNoteNumber: text("delivery_note_number").notNull(),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    quantity: integer("quantity").notNull(),
    returnedQuantity: integer("returned_quantity").notNull().default(0),
    location: text("location").notNull(),
    status: text("status")
      .notNull()
      .default(CUSTODY_STATUSES[0])
      .$type<CustodyStatus>(),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("personal_custodies_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "personal_custodies_returned_quantity_valid",
      sql`${table.returnedQuantity} >= 0 AND ${table.returnedQuantity} <= ${table.quantity}`
    ),
    check(
      "personal_custodies_status_valid",
      sql`${table.status} IN ('open', 'partially_returned', 'returned', 'damaged', 'closed')`
    ),
    index("personal_custodies_delivery_note_idx").on(table.deliveryNoteNumber),
    index("personal_custodies_equipment_status_idx").on(
      table.equipmentId,
      table.status
    ),
    index("personal_custodies_recipient_idx").on(table.recipientId),
  ]
);

export const insertPersonalCustodySchema = createInsertSchema(
  personalCustodiesTable
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPersonalCustody = z.infer<typeof insertPersonalCustodySchema>;
export type PersonalCustody = typeof personalCustodiesTable.$inferSelect;