import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userNameSnap: text("user_name_snap"),
  action: text("action").notNull(), // e.g. "create", "update", "delete", "login", "logout"
  entityType: text("entity_type").notNull(), // e.g. "item", "equipment", "transaction", "user"
  entityId: integer("entity_id"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
