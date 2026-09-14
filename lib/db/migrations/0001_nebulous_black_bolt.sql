CREATE TABLE "license_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"license" text,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_delivery_destination_valid";--> statement-breakpoint
UPDATE "transactions"
SET "delivery_destination" = 'health_facility'
WHERE "delivery_destination" = 'ambulance_point';--> statement-breakpoint
ALTER TABLE "system_settings" ALTER COLUMN "org_name" SET DEFAULT 'مستودعات مديرية صحة دمشق';--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "requires_expiry_tracking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "requires_batch_tracking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD COLUMN "supplier" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_delivery_destination_valid" CHECK ("transactions"."delivery_destination" IS NULL OR "transactions"."delivery_destination" IN ('administrative_building', 'health_facility', 'ambulance_point'));