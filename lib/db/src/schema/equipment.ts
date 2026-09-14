import {
  boolean,
  check,
  index,
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const equipmentTable = pgTable(
  "equipment",
  {
    id: serial("id").primaryKey(),
    // Phase 1 governance: catalog code + archive flag for equipment.
    code: text("code").unique(),
    name: text("name").notNull(),
    equipmentType: text("equipment_type"),
    model: text("model"),
    serialNumber: text("serial_number").unique(),
    condition: text("condition")
      .notNull()
      .$type<"good" | "maintenance" | "broken" | "consumed" | "needs_inspection">(),
    manufactureYear: integer("manufacture_year"),
    originCountry: text("origin_country"),
    currentHolder: text("current_holder"),
    notes: text("notes"),
    quantity: integer("quantity").notNull().default(1),
    minQuantity: integer("min_quantity").notNull().default(0),
    // Maintenance tracking fields
    maintenanceSentAt: date("maintenance_sent_at"),
    maintenanceReturnedAt: date("maintenance_returned_at"),
    maintenanceNotes: text("maintenance_notes"),
    // Phase 5: the site holding this equipment.
    warehouseId: integer("warehouse_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("equipment_quantity_non_negative", sql`${table.quantity} >= 0`),
    check("equipment_min_quantity_non_negative", sql`${table.minQuantity} >= 0`),
    index("equipment_condition_idx").on(table.condition),
    index("equipment_type_idx").on(table.equipmentType),
    index("equipment_active_idx").on(table.isActive),
  ]
);

export const insertEquipmentSchema = createInsertSchema(equipmentTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipmentTable.$inferSelect;
