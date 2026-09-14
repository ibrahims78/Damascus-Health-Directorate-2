import {
  check,
  index,
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";

export const itemsTable = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    code: text("code").unique(),
    name: text("name").notNull(),
    categoryId: integer("category_id").references(() => categoriesTable.id),
    itemType: text("item_type").notNull(),
    unit: text("unit").notNull(),
    currentStock: integer("current_stock").notNull().default(0),
    minStock: integer("min_stock").notNull().default(0),
    // Phase 2 policy flags. False preserves the legacy behavior until an
    // item or category is explicitly classified as requiring tracking.
    requiresExpiryTracking: boolean("requires_expiry_tracking").notNull().default(false),
    requiresBatchTracking: boolean("requires_batch_tracking").notNull().default(false),
    // Legacy summary fields remain for backwards compatibility. Detailed
    // expiry/batch data is stored in inventory_batches.
    expiryDate: date("expiry_date", { mode: "string" }),
    batchNumber: text("batch_number"),
    location: text("location"),
    supplier: text("supplier"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("items_current_stock_non_negative", sql`${table.currentStock} >= 0`),
    check("items_min_stock_non_negative", sql`${table.minStock} >= 0`),
    index("items_type_active_idx").on(table.itemType, table.isActive),
    index("items_expiry_date_idx").on(table.expiryDate),
  ]
);

export const insertItemSchema = createInsertSchema(itemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof itemsTable.$inferSelect;
