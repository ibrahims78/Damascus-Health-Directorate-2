-- Phase 1: inventory data foundation
-- Safe, additive migration for an existing development database.
-- Do not run this file against production directly; use the Replit publish
-- schema flow after review and backup.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Existing tables: add nullable document and inventory metadata first so
-- historical rows remain readable and are not invented with fake values.
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "document_date" date,
  ADD COLUMN IF NOT EXISTS "delivery_note_number" text,
  ADD COLUMN IF NOT EXISTS "delivery_note_date" date,
  ADD COLUMN IF NOT EXISTS "supply_source" text,
  ADD COLUMN IF NOT EXISTS "expiry_date" date,
  ADD COLUMN IF NOT EXISTS "batch_number" text,
  ADD COLUMN IF NOT EXISTS "internal_delivery_note_number" text,
  ADD COLUMN IF NOT EXISTS "internal_delivery_note_date" date,
  ADD COLUMN IF NOT EXISTS "delivery_destination" text,
  ADD COLUMN IF NOT EXISTS "custody_holder_name_snap" text,
  ADD COLUMN IF NOT EXISTS "custody_note_number" text,
  ADD COLUMN IF NOT EXISTS "custody_date" date,
  ADD COLUMN IF NOT EXISTS "custody_location" text,
  ADD COLUMN IF NOT EXISTS "custody_status" text,
  ADD COLUMN IF NOT EXISTS "return_condition" text,
  ADD COLUMN IF NOT EXISTS "reason" text,
  ADD COLUMN IF NOT EXISTS "is_historical_incomplete" boolean DEFAULT false NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_current_stock_non_negative'
  ) THEN
    ALTER TABLE "items"
      ADD CONSTRAINT "items_current_stock_non_negative"
      CHECK ("current_stock" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_min_stock_non_negative'
  ) THEN
    ALTER TABLE "items"
      ADD CONSTRAINT "items_min_stock_non_negative"
      CHECK ("min_stock" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'equipment_quantity_non_negative'
  ) THEN
    ALTER TABLE "equipment"
      ADD CONSTRAINT "equipment_quantity_non_negative"
      CHECK ("quantity" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'equipment_min_quantity_non_negative'
  ) THEN
    ALTER TABLE "equipment"
      ADD CONSTRAINT "equipment_min_quantity_non_negative"
      CHECK ("min_quantity" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_type_valid'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_type_valid"
      CHECK ("type" IN ('in', 'out', 'init', 'adjust', 'custody_out',
                        'custody_return', 'damage', 'central_return'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_item_type_valid'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_item_type_valid"
      CHECK ("item_type" IN ('item', 'equipment'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_quantity_positive'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_quantity_positive"
      CHECK ("quantity" IS NULL OR "quantity" > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_document_number_nonempty'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_document_number_nonempty"
      CHECK (length(btrim("document_number")) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_supply_source_central'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_supply_source_central"
      CHECK ("supply_source" IS NULL OR "supply_source" = 'central_warehouses');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_delivery_destination_valid'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_delivery_destination_valid"
      CHECK ("delivery_destination" IS NULL OR
             "delivery_destination" IN ('administrative_building', 'ambulance_point'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "items_type_active_idx"
  ON "items" USING btree ("item_type", "is_active");
CREATE INDEX IF NOT EXISTS "items_expiry_date_idx"
  ON "items" USING btree ("expiry_date");
CREATE INDEX IF NOT EXISTS "equipment_condition_idx"
  ON "equipment" USING btree ("condition");
CREATE INDEX IF NOT EXISTS "equipment_type_idx"
  ON "equipment" USING btree ("equipment_type");
CREATE INDEX IF NOT EXISTS "transactions_created_at_idx"
  ON "transactions" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "transactions_document_date_idx"
  ON "transactions" USING btree ("document_date");
CREATE INDEX IF NOT EXISTS "transactions_type_item_idx"
  ON "transactions" USING btree ("type", "item_type");
CREATE INDEX IF NOT EXISTS "transactions_item_idx"
  ON "transactions" USING btree ("item_id");
CREATE INDEX IF NOT EXISTS "transactions_equipment_idx"
  ON "transactions" USING btree ("equipment_id");

-- Multiple batches per item. Legacy item-level expiry/batch columns remain
-- untouched as compatibility summaries until a later backfill decision.
CREATE TABLE IF NOT EXISTS "inventory_batches" (
  "id" serial PRIMARY KEY NOT NULL,
  "item_id" integer NOT NULL REFERENCES "items"("id"),
  "batch_number" text,
  "received_quantity" integer NOT NULL,
  "remaining_quantity" integer NOT NULL,
  "expiry_date" date,
  "delivery_note_number" text,
  "delivery_note_date" date,
  "supply_source" text DEFAULT 'central_warehouses' NOT NULL,
  "source_transaction_id" integer REFERENCES "transactions"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_batches_received_positive" CHECK ("received_quantity" > 0),
  CONSTRAINT "inventory_batches_remaining_valid"
    CHECK ("remaining_quantity" >= 0 AND "remaining_quantity" <= "received_quantity"),
  CONSTRAINT "inventory_batches_supply_source_central"
    CHECK ("supply_source" = 'central_warehouses'),
  CONSTRAINT "inventory_batches_item_batch_expiry_note_unique"
    UNIQUE ("item_id", "batch_number", "expiry_date", "delivery_note_number")
);
CREATE INDEX IF NOT EXISTS "inventory_batches_item_expiry_idx"
  ON "inventory_batches" USING btree ("item_id", "expiry_date");
CREATE INDEX IF NOT EXISTS "inventory_batches_source_transaction_idx"
  ON "inventory_batches" USING btree ("source_transaction_id");

-- Per-transaction FEFO allocation snapshots.
CREATE TABLE IF NOT EXISTS "transaction_batch_allocations" (
  "id" serial PRIMARY KEY NOT NULL,
  "transaction_id" integer NOT NULL REFERENCES "transactions"("id") ON DELETE cascade,
  "batch_id" integer NOT NULL REFERENCES "inventory_batches"("id"),
  "quantity" integer NOT NULL,
  "batch_number_snap" text,
  "expiry_date_snap" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "transaction_batch_allocations_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "transaction_batch_allocations_transaction_batch_unique"
    UNIQUE ("transaction_id", "batch_id")
);
CREATE INDEX IF NOT EXISTS "transaction_batch_allocations_transaction_idx"
  ON "transaction_batch_allocations" USING btree ("transaction_id");
CREATE INDEX IF NOT EXISTS "transaction_batch_allocations_batch_idx"
  ON "transaction_batch_allocations" USING btree ("batch_id");

-- Personal custody ledger, separate from the equipment master record.
CREATE TABLE IF NOT EXISTS "personal_custodies" (
  "id" serial PRIMARY KEY NOT NULL,
  "equipment_id" integer NOT NULL REFERENCES "equipment"("id"),
  "source_transaction_id" integer REFERENCES "transactions"("id"),
  "recipient_id" integer REFERENCES "recipients"("id"),
  "holder_name_snap" text NOT NULL,
  "delivery_note_number" text NOT NULL,
  "delivery_date" date NOT NULL,
  "quantity" integer NOT NULL,
  "returned_quantity" integer DEFAULT 0 NOT NULL,
  "location" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "personal_custodies_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "personal_custodies_returned_quantity_valid"
    CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "quantity"),
  CONSTRAINT "personal_custodies_status_valid"
    CHECK ("status" IN ('open', 'partially_returned', 'returned', 'damaged', 'closed'))
);
CREATE INDEX IF NOT EXISTS "personal_custodies_equipment_status_idx"
  ON "personal_custodies" USING btree ("equipment_id", "status");
CREATE INDEX IF NOT EXISTS "personal_custodies_recipient_idx"
  ON "personal_custodies" USING btree ("recipient_id");
CREATE INDEX IF NOT EXISTS "personal_custodies_delivery_note_idx"
  ON "personal_custodies" USING btree ("delivery_note_number");

-- First-class, independently auditable event ledgers.
CREATE TABLE IF NOT EXISTS "damage_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "transaction_id" integer NOT NULL REFERENCES "transactions"("id"),
  "item_type" text NOT NULL,
  "item_id" integer REFERENCES "items"("id"),
  "equipment_id" integer REFERENCES "equipment"("id"),
  "quantity" integer NOT NULL,
  "reason" text NOT NULL,
  "damage_date" date NOT NULL,
  "document_number" text NOT NULL,
  "serial_number_snap" text,
  "notes" text,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "damage_records_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "damage_records_item_type_valid"
    CHECK ("item_type" IN ('item', 'equipment')),
  CONSTRAINT "damage_records_entity_reference_valid" CHECK (
    ("item_type" = 'item' AND "item_id" IS NOT NULL AND "equipment_id" IS NULL)
    OR
    ("item_type" = 'equipment' AND "item_id" IS NULL AND "equipment_id" IS NOT NULL)
  ),
  CONSTRAINT "damage_records_transaction_unique" UNIQUE ("transaction_id"),
  CONSTRAINT "damage_records_document_number_unique" UNIQUE ("document_number")
);
CREATE INDEX IF NOT EXISTS "damage_records_entity_idx"
  ON "damage_records" USING btree ("item_type", "item_id", "equipment_id");
CREATE INDEX IF NOT EXISTS "damage_records_damage_date_idx"
  ON "damage_records" USING btree ("damage_date");

CREATE TABLE IF NOT EXISTS "central_returns" (
  "id" serial PRIMARY KEY NOT NULL,
  "transaction_id" integer NOT NULL REFERENCES "transactions"("id"),
  "item_type" text NOT NULL,
  "item_id" integer REFERENCES "items"("id"),
  "equipment_id" integer REFERENCES "equipment"("id"),
  "quantity" integer NOT NULL,
  "return_date" date NOT NULL,
  "document_number" text NOT NULL,
  "receiving_party_snap" text DEFAULT 'central_warehouses' NOT NULL,
  "condition" text NOT NULL,
  "reason" text NOT NULL,
  "notes" text,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "central_returns_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "central_returns_item_type_valid"
    CHECK ("item_type" IN ('item', 'equipment')),
  CONSTRAINT "central_returns_entity_reference_valid" CHECK (
    ("item_type" = 'item' AND "item_id" IS NOT NULL AND "equipment_id" IS NULL)
    OR
    ("item_type" = 'equipment' AND "item_id" IS NULL AND "equipment_id" IS NOT NULL)
  ),
  CONSTRAINT "central_returns_party_central"
    CHECK ("receiving_party_snap" = 'central_warehouses'),
  CONSTRAINT "central_returns_condition_valid"
    CHECK ("condition" IN ('good', 'damaged', 'needs_maintenance', 'missing')),
  CONSTRAINT "central_returns_transaction_unique" UNIQUE ("transaction_id"),
  CONSTRAINT "central_returns_document_number_unique" UNIQUE ("document_number")
);
CREATE INDEX IF NOT EXISTS "central_returns_entity_idx"
  ON "central_returns" USING btree ("item_type", "item_id", "equipment_id");
CREATE INDEX IF NOT EXISTS "central_returns_return_date_idx"
  ON "central_returns" USING btree ("return_date");

CREATE TABLE IF NOT EXISTS "custody_returns" (
  "id" serial PRIMARY KEY NOT NULL,
  "custody_id" integer NOT NULL REFERENCES "personal_custodies"("id"),
  "transaction_id" integer NOT NULL REFERENCES "transactions"("id"),
  "quantity" integer NOT NULL,
  "return_date" date NOT NULL,
  "document_number" text NOT NULL,
  "condition" text NOT NULL,
  "returned_to_location" text NOT NULL,
  "inspection_notes" text,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "custody_returns_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "custody_returns_condition_valid"
    CHECK ("condition" IN ('good', 'damaged', 'needs_maintenance', 'missing')),
  CONSTRAINT "custody_returns_transaction_unique" UNIQUE ("transaction_id"),
  CONSTRAINT "custody_returns_document_number_unique" UNIQUE ("document_number")
);
CREATE INDEX IF NOT EXISTS "custody_returns_custody_date_idx"
  ON "custody_returns" USING btree ("custody_id", "return_date");

COMMIT;