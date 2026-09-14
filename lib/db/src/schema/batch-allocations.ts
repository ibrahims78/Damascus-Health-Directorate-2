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
import { transactionsTable } from "./transactions";
import { inventoryBatchesTable } from "./batches";

/**
 * Immutable audit detail for how an outgoing transaction consumed batches.
 * The snapshots preserve the historical document even if a batch is later
 * corrected administratively.
 */
export const transactionBatchAllocationsTable = pgTable(
  "transaction_batch_allocations",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactionsTable.id, { onDelete: "cascade" }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => inventoryBatchesTable.id),
    quantity: integer("quantity").notNull(),
    batchNumberSnap: text("batch_number_snap"),
    expiryDateSnap: date("expiry_date_snap", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("transaction_batch_allocations_quantity_positive", sql`${table.quantity} > 0`),
    unique("transaction_batch_allocations_transaction_batch_unique").on(
      table.transactionId,
      table.batchId
    ),
    index("transaction_batch_allocations_transaction_idx").on(table.transactionId),
    index("transaction_batch_allocations_batch_idx").on(table.batchId),
  ]
);

export const insertTransactionBatchAllocationSchema = createInsertSchema(
  transactionBatchAllocationsTable
).omit({
  id: true,
  createdAt: true,
});
export type InsertTransactionBatchAllocation = z.infer<
  typeof insertTransactionBatchAllocationSchema
>;
export type TransactionBatchAllocation =
  typeof transactionBatchAllocationsTable.$inferSelect;