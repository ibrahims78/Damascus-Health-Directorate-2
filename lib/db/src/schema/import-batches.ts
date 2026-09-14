import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Phase 3 - import governance.
 *
 * Every committed bulk import is journaled here so it can be audited and, when
 * needed, rolled back by an administrator. `rollback` holds the inverse
 * information (ids of created rows and the previous values of updated rows).
 */
export const importBatchesTable = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // "items" | "equipment"
    mode: text("mode").notNull(), // "insert" | "upsert"
    fileName: text("file_name"),
    fileHash: text("file_hash"),
    actorUserId: integer("actor_user_id"),
    actorName: text("actor_name"),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    openingBatchCount: integer("opening_batch_count").notNull().default(0),
    status: text("status").notNull().default("committed"), // committed | rolled_back
    summary: jsonb("summary"),
    rollback: jsonb("rollback"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rolledBackByUserId: integer("rolled_back_by_user_id"),
  },
  (table) => [index("import_batches_created_idx").on(table.createdAt)],
);

export const insertImportBatchSchema = createInsertSchema(importBatchesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ImportBatch = typeof importBatchesTable.$inferSelect;
