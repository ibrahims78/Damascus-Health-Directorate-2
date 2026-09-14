BEGIN;

ALTER TABLE "sync_conflicts"
  ADD COLUMN IF NOT EXISTS "severity" text NOT NULL DEFAULT 'medium';

CREATE TABLE IF NOT EXISTS "sync_trusted_nodes" (
  "node_id" text PRIMARY KEY NOT NULL,
  "node_type" text NOT NULL,
  "label" text,
  "status" text NOT NULL DEFAULT 'trusted',
  "paired_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "last_seen_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "sync_trusted_nodes_status_idx"
  ON "sync_trusted_nodes" ("status");

CREATE TABLE IF NOT EXISTS "sync_pairings" (
  "pairing_id" text PRIMARY KEY NOT NULL,
  "code_hash" text NOT NULL UNIQUE,
  "source_node_id" text NOT NULL,
  "target_node_id" text,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sync_pairings_expiry_idx"
  ON "sync_pairings" ("expires_at");
CREATE INDEX IF NOT EXISTS "sync_pairings_source_idx"
  ON "sync_pairings" ("source_node_id");

CREATE TABLE IF NOT EXISTS "sync_relay_packages" (
  "relay_id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL REFERENCES "sync_sessions" ("session_id") ON DELETE CASCADE,
  "package_id" text NOT NULL,
  "response_to_relay_id" text,
  "direction" text NOT NULL,
  "source_node_id" text NOT NULL,
  "target_node_id" text NOT NULL,
  "content_hash" text NOT NULL,
  "transport_hash" text NOT NULL,
  "payload" text NOT NULL,
  "status" text NOT NULL DEFAULT 'available',
  "expires_at" timestamptz NOT NULL,
  "downloaded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sync_relay_session_transport_unique"
    UNIQUE ("session_id", "transport_hash")
);
CREATE INDEX IF NOT EXISTS "sync_relay_packages_session_idx"
  ON "sync_relay_packages" ("session_id");
CREATE INDEX IF NOT EXISTS "sync_relay_packages_expiry_idx"
  ON "sync_relay_packages" ("expires_at");
CREATE INDEX IF NOT EXISTS "sync_relay_packages_status_idx"
  ON "sync_relay_packages" ("status");

COMMIT;