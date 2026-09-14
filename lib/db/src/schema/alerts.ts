import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const alertsTable = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    /** Type of alert condition */
    type: text("type")
      .notNull()
      .$type<
        | "below_min"
        | "near_expiry"
        | "equipment_maintenance"
        | "equipment_below_min"
      >(),
    /** ID of the related entity (item or equipment) */
    entityId: integer("entity_id").notNull(),
    /** Table the entity belongs to */
    entityType: text("entity_type")
      .notNull()
      .$type<"item" | "equipment">(),
    severity: text("severity")
      .notNull()
      .$type<"critical" | "warning" | "info">(),
    message: text("message").notNull(),
    /** Auto-resolved by worker when condition clears; manually resolved by admin */
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: integer("resolved_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One active alert per (type, entity) — worker upserts, not duplicates
    unique("alerts_type_entity_unique").on(
      table.type,
      table.entityId,
      table.entityType
    ),
  ]
);

/** Tracks which users have seen (read) each alert */
export const alertReadsTable = pgTable(
  "alert_reads",
  {
    alertId: integer("alert_id")
      .notNull()
      .references(() => alertsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.alertId, table.userId] })]
);

export type DbAlert = typeof alertsTable.$inferSelect;
export type DbAlertRead = typeof alertReadsTable.$inferSelect;
