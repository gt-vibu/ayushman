CREATE TABLE "booking_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"preferred_professional_user_id" uuid,
	"customer_user_id" uuid,
	"full_name" varchar(160) NOT NULL,
	"email" varchar(320),
	"phone" varchar(32),
	"requested_date" varchar(10) NOT NULL,
	"status" varchar(16) DEFAULT 'waiting' NOT NULL,
	"customer_note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_waitlist_status_check" CHECK ("booking_waitlist"."status" IN ('waiting', 'contacted', 'booked', 'closed')),
	CONSTRAINT "booking_waitlist_contact_check" CHECK ("booking_waitlist"."email" IS NOT NULL OR "booking_waitlist"."phone" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_preferred_professional_user_id_users_id_fk" FOREIGN KEY ("preferred_professional_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_service_practice_fk" FOREIGN KEY ("service_id","practice_id") REFERENCES "public"."services"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_waitlist_practice_status_date_idx" ON "booking_waitlist" USING btree ("practice_id","status","requested_date","created_at");--> statement-breakpoint
CREATE INDEX "booking_waitlist_customer_idx" ON "booking_waitlist" USING btree ("customer_user_id","created_at");