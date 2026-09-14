-- Phases 2–3: durable node identity and append-only sync stores.
-- This migration is additive. Existing business rows keep their local ids.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "operation_id" text,
  ADD COLUMN IF NOT EXISTS "origin_node_id" text,
  ADD COLUMN IF NOT EXISTS "origin_sequence" integer,
  ADD COLUMN IF NOT EXISTS "document_number_scope" text;

CREATE UNIQUE INDEX IF NOT EXISTS "transactions_operation_id_unique"
  ON "transactions" ("operation_id")
  WHERE "operation_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "node_identity" (
  "id" serial PRIMARY KEY NOT NULL,
  "node_id" text NOT NULL,
  "installation_id" text NOT NULL,
  "node_type" text NOT NULL,
  "key_id" text,
  "origin_sequence" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "node_identity_node_id_unique" UNIQUE("node_id"),
  CONSTRAINT "node_identity_installation_id_unique" UNIQUE("installation_id")
);

CREATE TABLE IF NOT EXISTS "sync_entity_ids" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "local_id" integer NOT NULL,
  "global_id" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "sync_entity_ids_global_id_unique" UNIQUE("global_id"),
  CONSTRAINT "sync_entity_ids_entity_local_unique" UNIQUE("entity_type", "local_id")
);

CREATE TABLE IF NOT EXISTS "sync_change_log" (
  "change_id" text PRIMARY KEY NOT NULL,
  "operation_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_global_id" text NOT NULL,
  "local_entity_id" integer,
  "change_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "origin_node_id" text NOT NULL,
  "origin_sequence" integer NOT NULL,
  "caused_by_change_id" text,
  "parent_revision" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "received_at" timestamptz,
  "applied_at" timestamptz,
  "status" text DEFAULT 'local-pending' NOT NULL,
  "rejection_code" text,
  CONSTRAINT "sync_change_log_operation_id_unique" UNIQUE("operation_id")
);

CREATE TABLE IF NOT EXISTS "sync_outbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "change_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "exported_at" timestamptz,
  "acknowledged_at" timestamptz,
  CONSTRAINT "sync_outbox_change_unique" UNIQUE("change_id"),
  CONSTRAINT "sync_outbox_change_fk"
    FOREIGN KEY ("change_id") REFERENCES "sync_change_log"("change_id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "sync_inbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "change_id" text NOT NULL,
  "origin_node_id" text NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "received_at" timestamptz DEFAULT now() NOT NULL,
  "applied_at" timestamptz,
  "rejection_code" text,
  CONSTRAINT "sync_inbox_change_unique" UNIQUE("change_id")
);

CREATE TABLE IF NOT EXISTS "sync_cursors" (
  "id" serial PRIMARY KEY NOT NULL,
  "peer_node_id" text NOT NULL,
  "vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "sync_cursors_peer_node_unique" UNIQUE("peer_node_id")
);

CREATE TABLE IF NOT EXISTS "sync_conflicts" (
  "id" serial PRIMARY KEY NOT NULL,
  "change_id" text NOT NULL,
  "conflict_code" text NOT NULL,
  "details" jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "resolved_by" integer,
  "resolution" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz,
  CONSTRAINT "sync_conflicts_change_unique" UNIQUE("change_id")
);

CREATE TABLE IF NOT EXISTS "sync_tombstones" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "entity_global_id" text NOT NULL,
  "deleted_by_change_id" text NOT NULL,
  "origin_node_id" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "propagated" boolean DEFAULT false NOT NULL,
  CONSTRAINT "sync_tombstones_entity_unique" UNIQUE("entity_type", "entity_global_id")
);

CREATE INDEX IF NOT EXISTS "sync_entity_ids_entity_type_idx"
  ON "sync_entity_ids" ("entity_type");
CREATE INDEX IF NOT EXISTS "sync_change_log_origin_sequence_idx"
  ON "sync_change_log" ("origin_node_id", "origin_sequence");
CREATE INDEX IF NOT EXISTS "sync_change_log_entity_idx"
  ON "sync_change_log" ("entity_type", "entity_global_id");
CREATE INDEX IF NOT EXISTS "sync_change_log_status_idx"
  ON "sync_change_log" ("status");
CREATE INDEX IF NOT EXISTS "sync_inbox_status_idx"
  ON "sync_inbox" ("status");
CREATE INDEX IF NOT EXISTS "sync_conflicts_status_idx"
  ON "sync_conflicts" ("status");
CREATE INDEX IF NOT EXISTS "sync_tombstones_propagated_idx"
  ON "sync_tombstones" ("propagated");

-- Give legacy rows a stable identity without inventing historical changes.
UPDATE "transactions"
SET
  "operation_id" = md5('legacy-operation:' || "id"::text),
  "origin_node_id" = 'legacy',
  "origin_sequence" = "id",
  "document_number_scope" = 'legacy:' || "type"
WHERE "operation_id" IS NULL;

INSERT INTO "sync_entity_ids" ("entity_type", "local_id", "global_id")
SELECT 'category', "id", md5('legacy:category:' || "id"::text) FROM "categories"
ON CONFLICT ("entity_type", "local_id") DO NOTHING;
INSERT INTO "sync_entity_ids" ("entity_type", "local_id", "global_id")
SELECT 'item', "id", md5('legacy:item:' || "id"::text) FROM "items"
ON CONFLICT ("entity_type", "local_id") DO NOTHING;
INSERT INTO "sync_entity_ids" ("entity_type", "local_id", "global_id")
SELECT 'equipment', "id", md5('legacy:equipment:' || "id"::text) FROM "equipment"
ON CONFLICT ("entity_type", "local_id") DO NOTHING;
INSERT INTO "sync_entity_ids" ("entity_type", "local_id", "global_id")
SELECT 'transaction', "id", md5('legacy:transaction:' || "id"::text) FROM "transactions"
ON CONFLICT ("entity_type", "local_id") DO NOTHING;
INSERT INTO "sync_entity_ids" ("entity_type", "local_id", "global_id")
SELECT 'recipient', "id", md5('legacy:recipient:' || "id"::text) FROM "recipients"
ON CONFLICT ("entity_type", "local_id") DO NOTHING;
INSERT INTO "sync_entity_ids" ("entity_type", "local_id", "global_id")
SELECT 'exit_reason', "id", md5('legacy:exit-reason:' || "id"::text) FROM "exit_reasons"
ON CONFLICT ("entity_type", "local_id") DO NOTHING;

COMMIT;