import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Phase 6 - inter-warehouse transfers.
 *
 * A transfer is a small state machine that always moves through the central
 * warehouse (star topology): requested -> issued -> received. Each step is
 * owned by the site that performs it, and the stock effect happens exactly
 * once on that site (offline-first: nothing waits for synchronisation).
 */
export const transfersTable = pgTable(
  "transfers",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    status: text("status").notNull().default("requested"),
    fromWarehouseId: integer("from_warehouse_id").notNull(),
    toWarehouseId: integer("to_warehouse_id").notNull(),
    requestedByUserId: integer("requested_by_user_id"),
    requestedByName: text("requested_by_name"),
    notes: text("notes"),
    deliveryNoteNumber: text("delivery_note_number"),
    provisional: boolean("provisional").notNull().default(false),
    rejectionReason: text("rejection_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("transfers_status_idx").on(table.status),
    index("transfers_to_idx").on(table.toWarehouseId, table.status),
  ],
);

export const transferLinesTable = pgTable(
  "transfer_lines",
  {
    id: serial("id").primaryKey(),
    transferId: integer("transfer_id").notNull(),
    itemId: integer("item_id").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit"),
    batchNumber: text("batch_number"),
    expiryDate: text("expiry_date"),
    notes: text("notes"),
    receivedQuantity: integer("received_quantity"),
    variance: integer("variance"),
    varianceReason: text("variance_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("transfer_lines_transfer_idx").on(table.transferId)],
);

export const insertTransferSchema = createInsertSchema(transfersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTransfer = z.infer<typeof insertTransferSchema>;
export type Transfer = typeof transfersTable.$inferSelect;
