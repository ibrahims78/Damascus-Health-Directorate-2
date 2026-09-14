import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Machine-bound license state for the PROTECTED desktop build.
 * Single row (id=1): the server-generated deviceId + the active license.
 */
export const licenseStateTable = pgTable("license_state", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  license: text("license"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
});
