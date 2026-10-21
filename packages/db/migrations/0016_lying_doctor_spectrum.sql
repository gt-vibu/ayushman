ALTER TABLE "booking_policies" ADD COLUMN "patient_rescheduling_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_policies" ADD COLUMN "rescheduling_cutoff_minutes" integer DEFAULT 360 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policy_reschedule_check" CHECK ("booking_policies"."rescheduling_cutoff_minutes" >= 0);