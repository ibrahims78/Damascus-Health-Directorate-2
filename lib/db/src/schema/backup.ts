import { integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";

export const backupRestorePointTable = pgTable("backup_restore_points", {
  id: text("id").primaryKey(),
  packageHash: text("package_hash").notNull(),
  encryptedPackage: text("encrypted_package").notNull(),
  createdBy: integer("created_by"),
  status: text("status").notNull().$type<"available" | "rolled-back">().default("available"),
  summary: jsonb("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
});

export const backupRestorePreviewTable = pgTable("backup_restore_previews", {
  token: text("token").primaryKey(),
  packageHash: text("package_hash").notNull(),
  mode: text("mode").notNull().$type<"full" | "merge">(),
  report: jsonb("report").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backupCatalogTable = pgTable("backup_catalog", {
  id: text("id").primaryKey(),
  packageHash: text("package_hash").notNull().unique(),
  packageType: text("package_type").notNull().$type<"full-backup" | "delta-sync">(),
  sourceNodeId: text("source_node_id").notNull(),
  baseVector: jsonb("base_vector").notNull().default({}),
  lastVector: jsonb("last_vector").notNull().default({}),
  retentionClass: text("retention_class")
    .notNull()
    .$type<"manual" | "daily" | "weekly" | "monthly">()
    .default("manual"),
  recordCount: integer("record_count").notNull().default(0),
  changeCount: integer("change_count").notNull().default(0),
  byteSize: integer("byte_size").notNull(),
  encryptedPackage: text("encrypted_package").notNull(),
  status: text("status").notNull().$type<"available" | "invalid" | "deleted">().default("available"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backupRetentionPolicyTable = pgTable("backup_retention_policy", {
  id: integer("id").primaryKey().default(1),
  dailyLimit: integer("daily_limit").notNull().default(30),
  weeklyLimit: integer("weekly_limit").notNull().default(12),
  monthlyLimit: integer("monthly_limit").notNull().default(12),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BackupRestorePoint = typeof backupRestorePointTable.$inferSelect;
export type BackupCatalogEntry = typeof backupCatalogTable.$inferSelect;