import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const DEFAULT_ORG_NAME = "مستودعات مديرية صحة دمشق";

export const systemSettingsTable = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  setupCompleted: boolean("setup_completed").notNull().default(false),
  setupAt: timestamp("setup_at", { withTimezone: true }),
  orgName: text("org_name").notNull().default(DEFAULT_ORG_NAME),
  orgSubtitle: text("org_subtitle"),
  expiryAlertDays: integer("expiry_alert_days").notNull().default(30),
  unitsList: text("units_list"),
  alertWebhookUrl: text("alert_webhook_url"), // JSON array of unit strings e.g. '["قطعة","علبة","لتر"]'
  technicalConditions: text("technical_conditions"), // JSON array of { key, label } objects
  returnConditions: text("return_conditions"), // JSON array of { key, label, behavior } objects
  // Phase 5: the warehouse this installation represents.
  warehouseId: integer("warehouse_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSystemSettingsSchema = createInsertSchema(systemSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSystemSettings = z.infer<typeof insertSystemSettingsSchema>;
export type SystemSettings = typeof systemSettingsTable.$inferSelect;
