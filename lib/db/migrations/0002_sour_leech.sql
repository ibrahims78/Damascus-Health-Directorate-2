CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"file_name" text,
	"file_hash" text,
	"actor_user_id" integer,
	"actor_name" text,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"opening_batch_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'committed' NOT NULL,
	"summary" jsonb,
	"rollback" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone,
	"rolled_back_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer NOT NULL,
	"doc_type" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sequences_scope_unique" UNIQUE("warehouse_id","doc_type","year")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'branch' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "transfer_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text,
	"batch_number" text,
	"expiry_date" text,
	"notes" text,
	"received_quantity" integer,
	"variance" integer,
	"variance_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"from_warehouse_id" integer NOT NULL,
	"to_warehouse_id" integer NOT NULL,
	"requested_by_user_id" integer,
	"requested_by_name" text,
	"notes" text,
	"delivery_note_number" text,
	"provisional" boolean DEFAULT false NOT NULL,
	"rejection_reason" text,
	"issued_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "count_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"item_code" text,
	"item_name" text NOT NULL,
	"unit" text NOT NULL,
	"bin_code" text,
	"batch_number" text,
	"system_quantity" integer DEFAULT 0 NOT NULL,
	"counted_quantity" integer,
	"variance" integer,
	"variance_reason" text,
	"counted_by_name" text,
	"counted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "count_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"warehouse_id" integer NOT NULL,
	"scope" text DEFAULT 'full' NOT NULL,
	"category_id" integer,
	"blind_count" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_user_id" integer,
	"created_by_name" text,
	"approved_by_user_id" integer,
	"approved_by_name" text,
	"lines_count" integer DEFAULT 0 NOT NULL,
	"counted_lines" integer DEFAULT 0 NOT NULL,
	"variance_lines" integer DEFAULT 0 NOT NULL,
	"total_variance" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "count_sessions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"item_code" text,
	"item_name" text NOT NULL,
	"unit" text NOT NULL,
	"ordered_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost" double precision,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"rejected_quantity" integer DEFAULT 0 NOT NULL,
	"rejection_reason" text,
	"batch_number" text,
	"expiry_date" text,
	"inspection_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"warehouse_id" integer NOT NULL,
	"supplier_name" text,
	"delivery_note_number" text,
	"delivery_note_date" text,
	"reference_number" text,
	"notes" text,
	"created_by_user_id" integer,
	"created_by_name" text,
	"posted_by_user_id" integer,
	"posted_by_name" text,
	"lines_count" integer DEFAULT 0 NOT NULL,
	"received_total" integer DEFAULT 0 NOT NULL,
	"rejected_total" integer DEFAULT 0 NOT NULL,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "bins" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" integer NOT NULL,
	"zone" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bins_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "warehouse_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "alert_webhook_url" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "warehouse_id" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "unit_cost" double precision;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "reorder_point" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "max_stock" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "safety_stock" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "bin_code" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "warehouse_id" integer;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "warehouse_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reversal_of_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reversed_by_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD COLUMN "unit_cost" double precision;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD COLUMN "warehouse_id" integer;--> statement-breakpoint
CREATE INDEX "import_batches_created_idx" ON "import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "warehouses_type_idx" ON "warehouses" USING btree ("type","is_active");--> statement-breakpoint
CREATE INDEX "transfer_lines_transfer_idx" ON "transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "transfers_status_idx" ON "transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transfers_to_idx" ON "transfers" USING btree ("to_warehouse_id","status");--> statement-breakpoint
CREATE INDEX "count_lines_session_idx" ON "count_lines" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "count_sessions_status_idx" ON "count_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "count_sessions_warehouse_idx" ON "count_sessions" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "receipt_lines_receipt_idx" ON "receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipts_status_idx" ON "receipts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "receipts_warehouse_idx" ON "receipts" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "bins_warehouse_idx" ON "bins" USING btree ("warehouse_id","is_active");--> statement-breakpoint
CREATE INDEX "equipment_active_idx" ON "equipment" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_code_unique" UNIQUE("code");