ALTER TYPE "public"."appointment_status" ADD VALUE 'held' BEFORE 'pending';--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "hold_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "appointments_hold_expiry_idx" ON "appointments" USING btree ("hold_expires_at");