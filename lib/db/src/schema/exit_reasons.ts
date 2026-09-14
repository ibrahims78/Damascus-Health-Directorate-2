import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const exitReasonsTable = pgTable("exit_reasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExitReasonSchema = createInsertSchema(exitReasonsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertExitReason = z.infer<typeof insertExitReasonSchema>;
export type ExitReason = typeof exitReasonsTable.$inferSelect;
