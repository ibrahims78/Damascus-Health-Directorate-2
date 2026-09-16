import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * P0 (warehouse practice audit) - cycle counting.
 *
 * A count session freezes a list of items with their system quantity (or hides
 * it for blind counts), collects the physical quantity per line and, once an
 * admin approves it, posts the differences as stock adjustments through the
 * normal movement service so the batch ledger stays the source of truth.
 */
export const countSessionsTable = pgTable(
  "count_sessions",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    status: text("status").notNull().default("open"),
    warehouseId: integer("warehouse_id").notNull(),
    scope: text("scope").notNull().default("full"),
    categoryId: integer("category_id"),
    blindCount: boolean("blind_count").notNull().default(true),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id"),
    createdByName: text("created_by_name"),
    approvedByUserId: integer("approved_by_user_id"),
    approvedByName: text("approved_by_name"),
    linesCount: integer("lines_count").notNull().default(0),
    countedLines: integer("counted_lines").notNull().default(0),
    varianceLines: integer("variance_lines").notNull().default(0),
    totalVariance: integer("total_variance").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("count_sessions_status_idx").on(table.status),
    index("count_sessions_warehouse_idx").on(table.warehouseId, table.status),
  ],
);

export const countLinesTable = pgTable(
  "count_lines",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull(),
    itemId: integer("item_id").notNull(),
    itemCode: text("item_code"),
    itemName: text("item_name").notNull(),
    unit: text("unit").notNull(),
    binCode: text("bin_code"),
    batchNumber: text("batch_number"),
    systemQuantity: integer("system_quantity").notNull().default(0),
    countedQuantity: integer("counted_quantity"),
    variance: integer("variance"),
    varianceReason: text("variance_reason"),
    countedByName: text("counted_by_name"),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("count_lines_session_idx").on(table.sessionId)],
);

export type CountSession = typeof countSessionsTable.$inferSelect;
export type CountLine = typeof countLinesTable.$inferSelect;
