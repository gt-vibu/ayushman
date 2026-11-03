ALTER TABLE "booking_waitlist" DROP CONSTRAINT "booking_waitlist_status_check";--> statement-breakpoint
DROP INDEX "booking_waitlist_active_email_uq";--> statement-breakpoint
DROP INDEX "booking_waitlist_active_phone_uq";--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD COLUMN "manage_token_hash" varchar(64);--> statement-breakpoint
UPDATE "booking_waitlist" SET "manage_token_hash" = md5(random()::text || clock_timestamp()::text || "id"::text) || md5(random()::text || clock_timestamp()::text || "practice_id"::text) WHERE "manage_token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ALTER COLUMN "manage_token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD COLUMN "offered_professional_user_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD COLUMN "offered_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD COLUMN "offer_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_offered_professional_user_id_users_id_fk" FOREIGN KEY ("offered_professional_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_waitlist_manage_token_uq" ON "booking_waitlist" USING btree ("manage_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_waitlist_active_email_uq" ON "booking_waitlist" USING btree ("practice_id","service_id","location_id","requested_date",lower("email")) WHERE "booking_waitlist"."email" IS NOT NULL AND "booking_waitlist"."status" IN ('waiting', 'contacted', 'offered', 'accepting');--> statement-breakpoint
CREATE UNIQUE INDEX "booking_waitlist_active_phone_uq" ON "booking_waitlist" USING btree ("practice_id","service_id","location_id","requested_date","phone") WHERE "booking_waitlist"."phone" IS NOT NULL AND "booking_waitlist"."status" IN ('waiting', 'contacted', 'offered', 'accepting');--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_offer_check" CHECK (("booking_waitlist"."status" IN ('offered', 'accepting') AND "booking_waitlist"."offered_professional_user_id" IS NOT NULL AND "booking_waitlist"."offered_starts_at" IS NOT NULL AND "booking_waitlist"."offer_expires_at" IS NOT NULL) OR ("booking_waitlist"."status" NOT IN ('offered', 'accepting') AND "booking_waitlist"."offered_starts_at" IS NULL AND "booking_waitlist"."offer_expires_at" IS NULL));--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_status_check" CHECK ("booking_waitlist"."status" IN ('waiting', 'contacted', 'offered', 'accepting', 'booked', 'closed', 'withdrawn', 'expired'));
