CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"setup_completed" boolean DEFAULT false NOT NULL,
	"setup_at" timestamp with time zone,
	"org_name" text DEFAULT 'مستودع الإحالة والإسعاف والطوارئ - دمشق' NOT NULL,
	"org_subtitle" text,
	"expiry_alert_days" integer DEFAULT 30 NOT NULL,
	"units_list" text,
	"technical_conditions" text,
	"return_conditions" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"category_id" integer,
	"item_type" text NOT NULL,
	"unit" text NOT NULL,
	"current_stock" integer DEFAULT 0 NOT NULL,
	"min_stock" integer DEFAULT 0 NOT NULL,
	"expiry_date" date,
	"batch_number" text,
	"location" text,
	"supplier" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_code_unique" UNIQUE("code"),
	CONSTRAINT "items_current_stock_non_negative" CHECK ("items"."current_stock" >= 0),
	CONSTRAINT "items_min_stock_non_negative" CHECK ("items"."min_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"equipment_type" text,
	"model" text,
	"serial_number" text,
	"condition" text NOT NULL,
	"manufacture_year" integer,
	"origin_country" text,
	"current_holder" text,
	"notes" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"min_quantity" integer DEFAULT 0 NOT NULL,
	"maintenance_sent_at" date,
	"maintenance_returned_at" date,
	"maintenance_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_serial_number_unique" UNIQUE("serial_number"),
	CONSTRAINT "equipment_quantity_non_negative" CHECK ("equipment"."quantity" >= 0),
	CONSTRAINT "equipment_min_quantity_non_negative" CHECK ("equipment"."min_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipients_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "exit_reasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exit_reasons_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_id" text,
	"origin_node_id" text,
	"origin_sequence" integer,
	"document_number_scope" text,
	"type" text NOT NULL,
	"item_type" text NOT NULL,
	"item_id" integer,
	"equipment_id" integer,
	"quantity" integer,
	"recipient_id" integer,
	"recipient_name_snap" text,
	"recipient_person" text,
	"exit_reason_id" integer,
	"exit_reason_snap" text,
	"document_number" text NOT NULL,
	"document_date" date,
	"delivery_note_number" text,
	"delivery_note_date" date,
	"supply_source" text,
	"expiry_date" date,
	"batch_number" text,
	"internal_delivery_note_number" text,
	"internal_delivery_note_date" date,
	"delivery_destination" text,
	"custody_holder_name_snap" text,
	"custody_note_number" text,
	"custody_date" date,
	"custody_location" text,
	"custody_status" text,
	"return_condition" text,
	"reason" text,
	"is_historical_incomplete" boolean DEFAULT false NOT NULL,
	"details" jsonb,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "transactions_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "transactions_type_valid" CHECK ("transactions"."type" IN ('in', 'out', 'init', 'adjust', 'custody_out', 'custody_return', 'damage', 'central_return')),
	CONSTRAINT "transactions_item_type_valid" CHECK ("transactions"."item_type" IN ('item', 'equipment')),
	CONSTRAINT "transactions_quantity_positive" CHECK ("transactions"."quantity" IS NULL OR "transactions"."quantity" > 0),
	CONSTRAINT "transactions_document_number_nonempty" CHECK (length(btrim("transactions"."document_number")) > 0),
	CONSTRAINT "transactions_supply_source_central" CHECK ("transactions"."supply_source" IS NULL OR "transactions"."supply_source" = 'central_warehouses'),
	CONSTRAINT "transactions_delivery_destination_valid" CHECK ("transactions"."delivery_destination" IS NULL OR "transactions"."delivery_destination" IN ('administrative_building', 'ambulance_point'))
);
--> statement-breakpoint
CREATE TABLE "inventory_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"batch_number" text,
	"received_quantity" integer NOT NULL,
	"remaining_quantity" integer NOT NULL,
	"expiry_date" date,
	"delivery_note_number" text,
	"delivery_note_date" date,
	"supply_source" text DEFAULT 'central_warehouses' NOT NULL,
	"source_transaction_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_batches_item_batch_expiry_note_unique" UNIQUE("item_id","batch_number","expiry_date","delivery_note_number"),
	CONSTRAINT "inventory_batches_received_positive" CHECK ("inventory_batches"."received_quantity" > 0),
	CONSTRAINT "inventory_batches_remaining_valid" CHECK ("inventory_batches"."remaining_quantity" >= 0 AND "inventory_batches"."remaining_quantity" <= "inventory_batches"."received_quantity"),
	CONSTRAINT "inventory_batches_supply_source_central" CHECK ("inventory_batches"."supply_source" = 'central_warehouses')
);
--> statement-breakpoint
CREATE TABLE "transaction_batch_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"batch_number_snap" text,
	"expiry_date_snap" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_batch_allocations_transaction_batch_unique" UNIQUE("transaction_id","batch_id"),
	CONSTRAINT "transaction_batch_allocations_quantity_positive" CHECK ("transaction_batch_allocations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "personal_custodies" (
	"id" serial PRIMARY KEY NOT NULL,
	"equipment_id" integer NOT NULL,
	"source_transaction_id" integer,
	"recipient_id" integer,
	"holder_name_snap" text NOT NULL,
	"delivery_note_number" text NOT NULL,
	"delivery_date" date NOT NULL,
	"quantity" integer NOT NULL,
	"returned_quantity" integer DEFAULT 0 NOT NULL,
	"location" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_custodies_quantity_positive" CHECK ("personal_custodies"."quantity" > 0),
	CONSTRAINT "personal_custodies_returned_quantity_valid" CHECK ("personal_custodies"."returned_quantity" >= 0 AND "personal_custodies"."returned_quantity" <= "personal_custodies"."quantity"),
	CONSTRAINT "personal_custodies_status_valid" CHECK ("personal_custodies"."status" IN ('open', 'partially_returned', 'returned', 'damaged', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "central_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"item_type" text NOT NULL,
	"item_id" integer,
	"equipment_id" integer,
	"quantity" integer NOT NULL,
	"return_date" date NOT NULL,
	"document_number" text NOT NULL,
	"receiving_party_snap" text DEFAULT 'central_warehouses' NOT NULL,
	"condition" text NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "central_returns_transaction_unique" UNIQUE("transaction_id"),
	CONSTRAINT "central_returns_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "central_returns_quantity_positive" CHECK ("central_returns"."quantity" > 0),
	CONSTRAINT "central_returns_item_type_valid" CHECK ("central_returns"."item_type" IN ('item', 'equipment')),
	CONSTRAINT "central_returns_entity_reference_valid" CHECK ((
    ("central_returns"."item_type" = 'item' AND "central_returns"."item_id" IS NOT NULL AND "central_returns"."equipment_id" IS NULL)
    OR
    ("central_returns"."item_type" = 'equipment' AND "central_returns"."item_id" IS NULL AND "central_returns"."equipment_id" IS NOT NULL)
  )),
	CONSTRAINT "central_returns_party_central" CHECK ("central_returns"."receiving_party_snap" = 'central_warehouses'),
	CONSTRAINT "central_returns_condition_valid" CHECK ("central_returns"."condition" IN ('good', 'damaged', 'needs_maintenance', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "custody_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"custody_id" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"return_date" date NOT NULL,
	"document_number" text NOT NULL,
	"condition" text NOT NULL,
	"returned_to_location" text NOT NULL,
	"inspection_notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_returns_transaction_unique" UNIQUE("transaction_id"),
	CONSTRAINT "custody_returns_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "custody_returns_quantity_positive" CHECK ("custody_returns"."quantity" > 0),
	CONSTRAINT "custody_returns_condition_valid" CHECK ("custody_returns"."condition" IN ('good', 'damaged', 'needs_maintenance', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "damage_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"item_type" text NOT NULL,
	"item_id" integer,
	"equipment_id" integer,
	"quantity" integer NOT NULL,
	"reason" text NOT NULL,
	"damage_date" date NOT NULL,
	"document_number" text NOT NULL,
	"serial_number_snap" text,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damage_records_transaction_unique" UNIQUE("transaction_id"),
	CONSTRAINT "damage_records_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "damage_records_quantity_positive" CHECK ("damage_records"."quantity" > 0),
	CONSTRAINT "damage_records_item_type_valid" CHECK ("damage_records"."item_type" IN ('item', 'equipment')),
	CONSTRAINT "damage_records_entity_reference_valid" CHECK ((
    ("damage_records"."item_type" = 'item' AND "damage_records"."item_id" IS NOT NULL AND "damage_records"."equipment_id" IS NULL)
    OR
    ("damage_records"."item_type" = 'equipment' AND "damage_records"."item_id" IS NULL AND "damage_records"."equipment_id" IS NOT NULL)
  ))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name_snap" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"details" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_reads" (
	"alert_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_reads_alert_id_user_id_pk" PRIMARY KEY("alert_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_type_entity_unique" UNIQUE("type","entity_id","entity_type")
);
--> statement-breakpoint
CREATE TABLE "node_identity" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"node_type" text NOT NULL,
	"key_id" text,
	"signing_public_key" text,
	"signing_private_key" text,
	"origin_sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_identity_node_id_unique" UNIQUE("node_id"),
	CONSTRAINT "node_identity_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "sync_change_log" (
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"status" text DEFAULT 'local-pending' NOT NULL,
	"rejection_code" text,
	CONSTRAINT "sync_change_log_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"conflict_code" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"details" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" integer,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "sync_conflicts_change_id_unique" UNIQUE("change_id")
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"id" serial PRIMARY KEY NOT NULL,
	"peer_node_id" text NOT NULL,
	"vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cursors_peer_node_id_unique" UNIQUE("peer_node_id")
);
--> statement-breakpoint
CREATE TABLE "sync_entity_ids" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"local_id" integer NOT NULL,
	"global_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_entity_ids_global_id_unique" UNIQUE("global_id"),
	CONSTRAINT "sync_entity_ids_entity_local_unique" UNIQUE("entity_type","local_id")
);
--> statement-breakpoint
CREATE TABLE "sync_inbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"origin_node_id" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"rejection_code" text,
	CONSTRAINT "sync_inbox_change_id_unique" UNIQUE("change_id")
);
--> statement-breakpoint
CREATE TABLE "sync_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "sync_outbox_change_unique" UNIQUE("change_id")
);
--> statement-breakpoint
CREATE TABLE "sync_pairings" (
	"pairing_id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_pairings_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "sync_relay_packages" (
	"relay_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"package_id" text NOT NULL,
	"response_to_relay_id" text,
	"direction" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"transport_hash" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_relay_session_transport_unique" UNIQUE("session_id","transport_hash")
);
--> statement-breakpoint
CREATE TABLE "sync_session_packages" (
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "sync_session_packages_hash_unique" UNIQUE("session_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "sync_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"source_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_last_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_last_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_tombstones" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_global_id" text NOT NULL,
	"deleted_by_change_id" text NOT NULL,
	"origin_node_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"propagated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sync_tombstones_entity_unique" UNIQUE("entity_type","entity_global_id")
);
--> statement-breakpoint
CREATE TABLE "sync_trusted_nodes" (
	"node_id" text PRIMARY KEY NOT NULL,
	"node_type" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'trusted' NOT NULL,
	"signing_public_key" text,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"package_hash" text NOT NULL,
	"package_type" text NOT NULL,
	"source_node_id" text NOT NULL,
	"base_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_vector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention_class" text DEFAULT 'manual' NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"change_count" integer DEFAULT 0 NOT NULL,
	"byte_size" integer NOT NULL,
	"encrypted_package" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_catalog_package_hash_unique" UNIQUE("package_hash")
);
--> statement-breakpoint
CREATE TABLE "backup_restore_points" (
	"id" text PRIMARY KEY NOT NULL,
	"package_hash" text NOT NULL,
	"encrypted_package" text NOT NULL,
	"created_by" integer,
	"status" text DEFAULT 'available' NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "backup_restore_previews" (
	"token" text PRIMARY KEY NOT NULL,
	"package_hash" text NOT NULL,
	"mode" text NOT NULL,
	"report" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_retention_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"daily_limit" integer DEFAULT 30 NOT NULL,
	"weekly_limit" integer DEFAULT 12 NOT NULL,
	"monthly_limit" integer DEFAULT 12 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_exit_reason_id_exit_reasons_id_fk" FOREIGN KEY ("exit_reason_id") REFERENCES "public"."exit_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_source_transaction_id_transactions_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_batch_allocations" ADD CONSTRAINT "transaction_batch_allocations_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_batch_allocations" ADD CONSTRAINT "transaction_batch_allocations_batch_id_inventory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_custodies" ADD CONSTRAINT "personal_custodies_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_custodies" ADD CONSTRAINT "personal_custodies_source_transaction_id_transactions_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_custodies" ADD CONSTRAINT "personal_custodies_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_custodies" ADD CONSTRAINT "personal_custodies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_returns" ADD CONSTRAINT "central_returns_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_returns" ADD CONSTRAINT "central_returns_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_returns" ADD CONSTRAINT "central_returns_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_returns" ADD CONSTRAINT "central_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_returns" ADD CONSTRAINT "custody_returns_custody_id_personal_custodies_id_fk" FOREIGN KEY ("custody_id") REFERENCES "public"."personal_custodies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_returns" ADD CONSTRAINT "custody_returns_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_returns" ADD CONSTRAINT "custody_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_reads" ADD CONSTRAINT "alert_reads_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_reads" ADD CONSTRAINT "alert_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_outbox" ADD CONSTRAINT "sync_outbox_change_id_sync_change_log_change_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."sync_change_log"("change_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_relay_packages" ADD CONSTRAINT "sync_relay_packages_session_id_sync_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sync_sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_session_packages" ADD CONSTRAINT "sync_session_packages_session_id_sync_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sync_sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_type_active_idx" ON "items" USING btree ("item_type","is_active");--> statement-breakpoint
CREATE INDEX "items_expiry_date_idx" ON "items" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "equipment_condition_idx" ON "equipment" USING btree ("condition");--> statement-breakpoint
CREATE INDEX "equipment_type_idx" ON "equipment" USING btree ("equipment_type");--> statement-breakpoint
CREATE INDEX "transactions_created_at_idx" ON "transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "transactions_document_date_idx" ON "transactions" USING btree ("document_date");--> statement-breakpoint
CREATE INDEX "transactions_type_item_idx" ON "transactions" USING btree ("type","item_type");--> statement-breakpoint
CREATE INDEX "transactions_item_idx" ON "transactions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "transactions_equipment_idx" ON "transactions" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "inventory_batches_item_expiry_idx" ON "inventory_batches" USING btree ("item_id","expiry_date");--> statement-breakpoint
CREATE INDEX "inventory_batches_source_transaction_idx" ON "inventory_batches" USING btree ("source_transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_batch_allocations_transaction_idx" ON "transaction_batch_allocations" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_batch_allocations_batch_idx" ON "transaction_batch_allocations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "personal_custodies_delivery_note_idx" ON "personal_custodies" USING btree ("delivery_note_number");--> statement-breakpoint
CREATE INDEX "personal_custodies_equipment_status_idx" ON "personal_custodies" USING btree ("equipment_id","status");--> statement-breakpoint
CREATE INDEX "personal_custodies_recipient_idx" ON "personal_custodies" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "central_returns_entity_idx" ON "central_returns" USING btree ("item_type","item_id","equipment_id");--> statement-breakpoint
CREATE INDEX "central_returns_return_date_idx" ON "central_returns" USING btree ("return_date");--> statement-breakpoint
CREATE INDEX "custody_returns_custody_date_idx" ON "custody_returns" USING btree ("custody_id","return_date");--> statement-breakpoint
CREATE INDEX "damage_records_entity_idx" ON "damage_records" USING btree ("item_type","item_id","equipment_id");--> statement-breakpoint
CREATE INDEX "damage_records_damage_date_idx" ON "damage_records" USING btree ("damage_date");--> statement-breakpoint
CREATE INDEX "sync_change_log_origin_sequence_idx" ON "sync_change_log" USING btree ("origin_node_id","origin_sequence");--> statement-breakpoint
CREATE INDEX "sync_change_log_entity_idx" ON "sync_change_log" USING btree ("entity_type","entity_global_id");--> statement-breakpoint
CREATE INDEX "sync_change_log_status_idx" ON "sync_change_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_conflicts_status_idx" ON "sync_conflicts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_entity_ids_entity_type_idx" ON "sync_entity_ids" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "sync_inbox_status_idx" ON "sync_inbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_pairings_expiry_idx" ON "sync_pairings" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_pairings_source_idx" ON "sync_pairings" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "sync_relay_packages_session_idx" ON "sync_relay_packages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sync_relay_packages_expiry_idx" ON "sync_relay_packages" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_relay_packages_status_idx" ON "sync_relay_packages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_session_packages_session_idx" ON "sync_session_packages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sync_session_packages_status_idx" ON "sync_session_packages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_sessions_source_idx" ON "sync_sessions" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "sync_sessions_target_idx" ON "sync_sessions" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "sync_sessions_status_idx" ON "sync_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_tombstones_propagated_idx" ON "sync_tombstones" USING btree ("propagated");--> statement-breakpoint
CREATE INDEX "sync_trusted_nodes_status_idx" ON "sync_trusted_nodes" USING btree ("status");