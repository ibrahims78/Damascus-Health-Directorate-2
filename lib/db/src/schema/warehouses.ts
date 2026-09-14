import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Phase 5 - warehouse model.
 *
 * The application used to be single-warehouse by construction (balances were a
 * single scalar per item and the supply source was hard-pinned to
 * `central_warehouses`). This table introduces first-class warehouses so each
 * installation can own its own site while still exchanging data.
 */
export const warehousesTable = pgTable(
  "warehouses",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    type: text("type").notNull().$type<"central" | "branch">().default("branch"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("warehouses_type_idx").on(table.type, table.isActive)],
);

export const insertWarehouseSchema = createInsertSchema(warehousesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWarehouse = z.infer<typeof insertWarehouseSchema>;
export type Warehouse = typeof warehousesTable.$inferSelect;

/**
 * Per-warehouse, per-document-type, per-year counter. Document numbers include
 * the warehouse code, so numbers stay globally unique after merging data from
 * several sites without any central coordination.
 */
export const documentSequencesTable = pgTable(
  "document_sequences",
  {
    id: serial("id").primaryKey(),
    warehouseId: integer("warehouse_id").notNull(),
    docType: text("doc_type").notNull(),
    year: integer("year").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("document_sequences_scope_unique").on(table.warehouseId, table.docType, table.year),
  ],
);
