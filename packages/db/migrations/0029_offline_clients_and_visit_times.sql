ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_contact_required_check";
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "actual_arrived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "actual_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "actual_ended_at" timestamp with time zone;
