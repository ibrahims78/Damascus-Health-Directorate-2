-- Phase 7: durable handshake, delta package, resume and acknowledgement state.
BEGIN;

CREATE TABLE IF NOT EXISTS "sync_sessions" (
  "session_id" text PRIMARY KEY NOT NULL,
  "source_node_id" text NOT NULL,
  "target_node_id" text NOT NULL,
  "status" text DEFAULT 'created' NOT NULL,
  "source_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "target_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_last_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "target_last_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "sync_session_packages" (
  "package_id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "direction" text NOT NULL,
  "source_node_id" text NOT NULL,
  "target_node_id" text NOT NULL,
  "base_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "status" text DEFAULT 'prepared' NOT NULL,
  "report" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "acknowledged_at" timestamptz,
  CONSTRAINT "sync_session_packages_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "sync_sessions" ("session_id") ON DELETE CASCADE,
  CONSTRAINT "sync_session_packages_hash_unique"
    UNIQUE ("session_id", "content_hash")
);

CREATE INDEX IF NOT EXISTS "sync_sessions_source_idx"
  ON "sync_sessions" ("source_node_id");
CREATE INDEX IF NOT EXISTS "sync_sessions_target_idx"
  ON "sync_sessions" ("target_node_id");
CREATE INDEX IF NOT EXISTS "sync_sessions_status_idx"
  ON "sync_sessions" ("status");
CREATE INDEX IF NOT EXISTS "sync_session_packages_session_idx"
  ON "sync_session_packages" ("session_id");
CREATE INDEX IF NOT EXISTS "sync_session_packages_status_idx"
  ON "sync_session_packages" ("status");

COMMIT;