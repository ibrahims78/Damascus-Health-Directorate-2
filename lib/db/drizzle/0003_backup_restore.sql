-- Phases 4–5: canonical encrypted package previews and rollback points.
BEGIN;

CREATE TABLE IF NOT EXISTS "backup_restore_points" (
  "id" text PRIMARY KEY NOT NULL,
  "package_hash" text NOT NULL,
  "encrypted_package" text NOT NULL,
  "created_by" integer,
  "status" text DEFAULT 'available' NOT NULL,
  "summary" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "rolled_back_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "backup_restore_previews" (
  "token" text PRIMARY KEY NOT NULL,
  "package_hash" text NOT NULL,
  "mode" text NOT NULL,
  "report" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "backup_restore_previews_expires_idx"
  ON "backup_restore_previews" ("expires_at");

COMMIT;