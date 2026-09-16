import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * P0-2 (warehouse practice audit) - goods receipt note (GRN) with inspection.
 *
 * A receipt is raised against a supplier delivery note, the warehouse records
 * the ordered / received / rejected quantities per line (partial receipts and
 * over-receipts are allowed and visible), and posting the receipt turns the
 * accepted quantities into inbound movements (batches) - nothing enters stock
 * before the GRN is posted.
 */
export const receiptsTable = pgTable(
  "receipts",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    status: text("status").notNull().default("draft"),
    warehouseId: integer("warehouse_id").notNull(),
    supplierName: text("supplier_name"),
    deliveryNoteNumber: text("delivery_note_number"),
    deliveryNoteDate: text("delivery_note_date"),
    referenceNumber: text("reference_number"),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id"),
    createdByName: text("created_by_name"),
    postedByUserId: integer("posted_by_user_id"),
    postedByName: text("posted_by_name"),
    linesCount: integer("lines_count").notNull().default(0),
    receivedTotal: integer("received_total").notNull().default(0),
    rejectedTotal: integer("rejected_total").notNull().default(0),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("receipts_status_idx").on(table.status),
    index("receipts_warehouse_idx").on(table.warehouseId, table.status),
  ],
);

export const receiptLinesTable = pgTable(
  "receipt_lines",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id").notNull(),
    itemId: integer("item_id").notNull(),
    itemCode: text("item_code"),
    itemName: text("item_name").notNull(),
    unit: text("unit").notNull(),
    orderedQuantity: integer("ordered_quantity").notNull().default(0),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    rejectedQuantity: integer("rejected_quantity").notNull().default(0),
    rejectionReason: text("rejection_reason"),
    batchNumber: text("batch_number"),
    expiryDate: text("expiry_date"),
    inspectionNotes: text("inspection_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("receipt_lines_receipt_idx").on(table.receiptId)],
);

export type Receipt = typeof receiptsTable.$inferSelect;
export type ReceiptLine = typeof receiptLinesTable.$inferSelect;
