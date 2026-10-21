DROP INDEX "clients_practice_email_idx";--> statement-breakpoint
ALTER TABLE "booking_policies" ADD COLUMN "patient_cancellation_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_policies" ADD COLUMN "email_notifications_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "clients_practice_email_idx" ON "clients" USING btree ("practice_id",lower("email"));--> statement-breakpoint
ALTER TABLE "practice_professions" ADD CONSTRAINT "practice_profession_code_format_check" CHECK ("practice_professions"."profession_code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');