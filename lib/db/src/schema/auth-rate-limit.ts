import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent, DB-backed rate limiting for auth endpoints.
 *
 * Unlike an in-memory Map, this table survives restarts, is shared by every
 * instance pointing at the same database (hosted PostgreSQL), and can be
 * inspected/cleaned with ordinary SQL. The key is the client IP (or a
 * derived key for proxied requests); `reset_at` defines the sliding window.
 */
export const authRateLimitTable = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
