CREATE TABLE "appointment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"from_status" "appointment_status",
	"to_status" "appointment_status" NOT NULL,
	"actor_user_id" uuid,
	"reason" varchar(500),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "practices" DROP CONSTRAINT "practices_slug_unique";--> statement-breakpoint
ALTER TABLE "availability_exceptions" DROP CONSTRAINT "exception_scope_check";--> statement-breakpoint
ALTER TABLE "availability_rules" DROP CONSTRAINT "availability_scope_refs_check";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_service_practice_fk";--> statement-breakpoint
ALTER TABLE "service_locations" DROP CONSTRAINT "service_locations_service_id_services_id_fk";--> statement-breakpoint
ALTER TABLE "service_locations" DROP CONSTRAINT "service_locations_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "service_professionals" DROP CONSTRAINT "service_professionals_service_id_services_id_fk";--> statement-breakpoint
ALTER TABLE "service_professionals" DROP CONSTRAINT "service_professionals_professional_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "practice_profession_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "service_name_snapshot" varchar(160) NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "duration_minutes_snapshot" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "price_minor_snapshot" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "currency_snapshot" varchar(3) NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD COLUMN "practice_profession_id" uuid;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD COLUMN "practice_profession_id" uuid;--> statement-breakpoint
ALTER TABLE "location_professions" ADD COLUMN "practice_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "website" varchar(500);--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "public_listing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_locations" ADD COLUMN "practice_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD COLUMN "practice_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "service_locations" ADD COLUMN "practice_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "service_locations" ADD COLUMN "practice_profession_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "service_professionals" ADD COLUMN "practice_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "service_professionals" ADD COLUMN "practice_profession_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX "appointment_events_appointment_time_idx" ON "appointment_events" USING btree ("appointment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "appointment_events_practice_time_idx" ON "appointment_events" USING btree ("practice_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_id_practice_uq" ON "appointments" USING btree ("id","practice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_practice_id_uq" ON "locations" USING btree ("practice_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "practices_slug_normalized_uq" ON "practices" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "professional_profiles_public_search_idx" ON "professional_profiles" USING btree ("practice_profession_id","public_profile");--> statement-breakpoint
CREATE UNIQUE INDEX "service_professionals_assignment_uq" ON "service_professionals" USING btree ("service_id","professional_user_id","practice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_id_practice_profession_uq" ON "services" USING btree ("id","practice_id","practice_profession_id");--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_practice_fk" FOREIGN KEY ("appointment_id","practice_id") REFERENCES "public"."appointments"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practice_profession_id_practice_professions_id_fk" FOREIGN KEY ("practice_profession_id") REFERENCES "public"."practice_professions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_profession_practice_fk" FOREIGN KEY ("service_id","practice_id","practice_profession_id") REFERENCES "public"."services"("id","practice_id","practice_profession_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_professional_assignment_fk" FOREIGN KEY ("service_id","professional_user_id","practice_id") REFERENCES "public"."service_professionals"("service_id","professional_user_id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_location_assignment_fk" FOREIGN KEY ("service_id","location_id") REFERENCES "public"."service_locations"("service_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_location_assignment_fk" FOREIGN KEY ("practice_profession_id","professional_user_id","location_id") REFERENCES "public"."professional_locations"("practice_profession_id","user_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_practice_profession_id_practice_professions_id_fk" FOREIGN KEY ("practice_profession_id") REFERENCES "public"."practice_professions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_profession_practice_fk" FOREIGN KEY ("practice_profession_id","practice_id") REFERENCES "public"."practice_professions"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_professional_membership_fk" FOREIGN KEY ("practice_id","professional_user_id") REFERENCES "public"."practice_memberships"("practice_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_professional_profile_fk" FOREIGN KEY ("practice_profession_id","professional_user_id") REFERENCES "public"."professional_profiles"("practice_profession_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_professional_location_fk" FOREIGN KEY ("practice_profession_id","professional_user_id","location_id") REFERENCES "public"."professional_locations"("practice_profession_id","user_id","location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_practice_profession_id_practice_professions_id_fk" FOREIGN KEY ("practice_profession_id") REFERENCES "public"."practice_professions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_profession_practice_fk" FOREIGN KEY ("practice_profession_id","practice_id") REFERENCES "public"."practice_professions"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_professional_membership_fk" FOREIGN KEY ("practice_id","professional_user_id") REFERENCES "public"."practice_memberships"("practice_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_professional_profile_fk" FOREIGN KEY ("practice_profession_id","professional_user_id") REFERENCES "public"."professional_profiles"("practice_profession_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_professional_location_fk" FOREIGN KEY ("practice_profession_id","professional_user_id","location_id") REFERENCES "public"."professional_locations"("practice_profession_id","user_id","location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_professions" ADD CONSTRAINT "location_professions_profession_practice_fk" FOREIGN KEY ("practice_profession_id","practice_id") REFERENCES "public"."practice_professions"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_professions" ADD CONSTRAINT "location_professions_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_locations" ADD CONSTRAINT "professional_locations_profile_fk" FOREIGN KEY ("practice_profession_id","user_id") REFERENCES "public"."professional_profiles"("practice_profession_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_locations" ADD CONSTRAINT "professional_locations_profession_practice_fk" FOREIGN KEY ("practice_profession_id","practice_id") REFERENCES "public"."practice_professions"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_locations" ADD CONSTRAINT "professional_locations_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_locations" ADD CONSTRAINT "professional_locations_membership_fk" FOREIGN KEY ("practice_id","user_id") REFERENCES "public"."practice_memberships"("practice_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_profession_practice_fk" FOREIGN KEY ("practice_profession_id","practice_id") REFERENCES "public"."practice_professions"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_membership_fk" FOREIGN KEY ("practice_id","user_id") REFERENCES "public"."practice_memberships"("practice_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_service_practice_fk" FOREIGN KEY ("service_id","practice_id","practice_profession_id") REFERENCES "public"."services"("id","practice_id","practice_profession_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_profession_enabled_fk" FOREIGN KEY ("practice_profession_id","location_id") REFERENCES "public"."location_professions"("practice_profession_id","location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_service_practice_fk" FOREIGN KEY ("service_id","practice_id","practice_profession_id") REFERENCES "public"."services"("id","practice_id","practice_profession_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_profile_fk" FOREIGN KEY ("practice_profession_id","professional_user_id") REFERENCES "public"."professional_profiles"("practice_profession_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_membership_fk" FOREIGN KEY ("practice_id","professional_user_id") REFERENCES "public"."practice_memberships"("practice_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_profession_practice_fk" FOREIGN KEY ("practice_profession_id","practice_id") REFERENCES "public"."practice_professions"("id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_duration_snapshot_check" CHECK ("appointments"."duration_minutes_snapshot" > 0);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_price_snapshot_check" CHECK ("appointments"."price_minor_snapshot" IS NULL OR "appointments"."price_minor_snapshot" >= 0);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancel_metadata_check" CHECK (("appointments"."status" = 'cancelled' AND "appointments"."cancelled_at" IS NOT NULL) OR ("appointments"."status" <> 'cancelled' AND "appointments"."cancelled_at" IS NULL));--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "exception_extra_hours_range_check" CHECK ("availability_exceptions"."kind" <> 'extra_hours' OR ("availability_exceptions"."start_minute" IS NOT NULL AND "availability_exceptions"."end_minute" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "exception_scope_check" CHECK (("availability_exceptions"."location_id" IS NOT NULL OR "availability_exceptions"."professional_user_id" IS NOT NULL) AND (("availability_exceptions"."professional_user_id" IS NULL AND "availability_exceptions"."practice_profession_id" IS NULL) OR ("availability_exceptions"."professional_user_id" IS NOT NULL AND "availability_exceptions"."practice_profession_id" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_scope_refs_check" CHECK (("availability_rules"."scope" = 'practice' AND "availability_rules"."location_id" IS NULL AND "availability_rules"."professional_user_id" IS NULL AND "availability_rules"."practice_profession_id" IS NULL) OR ("availability_rules"."scope" = 'location' AND "availability_rules"."location_id" IS NOT NULL AND "availability_rules"."professional_user_id" IS NULL AND "availability_rules"."practice_profession_id" IS NULL) OR ("availability_rules"."scope" = 'professional' AND "availability_rules"."location_id" IS NULL AND "availability_rules"."professional_user_id" IS NOT NULL AND "availability_rules"."practice_profession_id" IS NOT NULL) OR ("availability_rules"."scope" = 'professional_location' AND "availability_rules"."location_id" IS NOT NULL AND "availability_rules"."professional_user_id" IS NOT NULL AND "availability_rules"."practice_profession_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_slug_format_check" CHECK ("practices"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
