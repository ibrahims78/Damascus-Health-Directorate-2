-- Phase 2: inventory policy and FEFO schema completion.
-- Additive and idempotent. Legacy item-level summary fields are intentionally
-- retained; no historical values are silently copied into batch records.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "requires_expiry_tracking" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requires_batch_tracking" boolean NOT NULL DEFAULT false;

ALTER TABLE "inventory_batches"
  ADD COLUMN IF NOT EXISTS "supplier" text;

CREATE INDEX IF NOT EXISTS "inventory_batches_item_fefo_idx"
  ON "inventory_batches" USING btree ("item_id", "expiry_date", "id")
  WHERE "remaining_quantity" > 0;

COMMENT ON COLUMN "items"."expiry_date" IS
  'Legacy compatibility summary; detailed expiry belongs to inventory_batches.';
COMMENT ON COLUMN "items"."batch_number" IS
  'Legacy compatibility summary; detailed batch identity belongs to inventory_batches.';
COMMENT ON COLUMN "items"."supplier" IS
  'Legacy compatibility summary; per-receipt supplier belongs to inventory_batches.supplier.';
COMMENT ON COLUMN "inventory_batches"."delivery_note_number" IS
  'Reference number for the inbound or opening movement that created the batch.';
COMMENT ON COLUMN "inventory_batches"."delivery_note_date" IS
  'Reference date for the inbound or opening movement that created the batch.';
COMMENT ON COLUMN "inventory_batches"."source_transaction_id" IS
  'Source movement; nullable only for pre-migration legacy rows.';

COMMIT;