import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * P1-6 (warehouse practice audit) - structured storage locations.
 *
 * A bin belongs to a warehouse (optionally grouped in a zone) and carries the
 * code that movements and count lines refer to. Items keep `bin_code` so the
 * location travels with the item, while this catalog makes the values typed,
 * validated and printable as shelf labels.
 */
export const binsTable = pgTable(
  "bins",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    warehouseId: integer("warehouse_id").notNull(),
    zone: text("zone"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("bins_warehouse_idx").on(table.warehouseId, table.isActive)],
);

export type Bin = typeof binsTable.$inferSelect;
