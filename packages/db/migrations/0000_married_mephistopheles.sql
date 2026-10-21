CREATE TYPE "public"."appointment_status" AS ENUM('pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."availability_scope" AS ENUM('practice', 'location', 'professional', 'professional_location');--> statement-breakpoint
CREATE TYPE "public"."exception_kind" AS ENUM('closed', 'extra_hours');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'professional', 'scheduler');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"professional_user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reserved_starts_at" timestamp with time zone NOT NULL,
	"reserved_ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"status" "appointment_status" DEFAULT 'confirmed' NOT NULL,
	"client_note" varchar(1000),
	"cancellation_reason" varchar(240),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_order_check" CHECK ("appointments"."starts_at" < "appointments"."ends_at"),
	CONSTRAINT "appointments_reserved_range_check" CHECK ("appointments"."reserved_starts_at" <= "appointments"."starts_at" AND "appointments"."ends_at" <= "appointments"."reserved_ends_at")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"location_id" uuid,
	"professional_user_id" uuid,
	"date" date NOT NULL,
	"kind" "exception_kind" NOT NULL,
	"start_minute" integer,
	"end_minute" integer,
	"reason" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exception_time_pair_check" CHECK (("availability_exceptions"."start_minute" IS NULL AND "availability_exceptions"."end_minute" IS NULL) OR ("availability_exceptions"."start_minute" >= 0 AND "availability_exceptions"."start_minute" < "availability_exceptions"."end_minute" AND "availability_exceptions"."end_minute" <= 1440)),
	CONSTRAINT "exception_scope_check" CHECK ("availability_exceptions"."location_id" IS NOT NULL OR "availability_exceptions"."professional_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"scope" "availability_scope" NOT NULL,
	"location_id" uuid,
	"professional_user_id" uuid,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"slot_interval_minutes" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_weekday_check" CHECK ("availability_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "availability_time_range_check" CHECK ("availability_rules"."start_minute" >= 0 AND "availability_rules"."start_minute" < "availability_rules"."end_minute" AND "availability_rules"."end_minute" <= 1440),
	CONSTRAINT "availability_interval_check" CHECK ("availability_rules"."slot_interval_minutes" BETWEEN 5 AND 240),
	CONSTRAINT "availability_scope_refs_check" CHECK (("availability_rules"."scope" = 'practice' AND "availability_rules"."location_id" IS NULL AND "availability_rules"."professional_user_id" IS NULL) OR ("availability_rules"."scope" = 'location' AND "availability_rules"."location_id" IS NOT NULL AND "availability_rules"."professional_user_id" IS NULL) OR ("availability_rules"."scope" = 'professional' AND "availability_rules"."location_id" IS NULL AND "availability_rules"."professional_user_id" IS NOT NULL) OR ("availability_rules"."scope" = 'professional_location' AND "availability_rules"."location_id" IS NOT NULL AND "availability_rules"."professional_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "booking_policies" (
	"practice_id" uuid PRIMARY KEY NOT NULL,
	"max_advance_days" integer DEFAULT 30 NOT NULL,
	"min_notice_minutes" integer DEFAULT 120 NOT NULL,
	"cancellation_cutoff_minutes" integer DEFAULT 360 NOT NULL,
	"guest_booking_enabled" boolean DEFAULT true NOT NULL,
	"require_prepayment" boolean DEFAULT false NOT NULL,
	"confirmation_mode" varchar(16) DEFAULT 'immediate' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_policy_advance_check" CHECK ("booking_policies"."max_advance_days" BETWEEN 1 AND 365),
	CONSTRAINT "booking_policy_notice_check" CHECK ("booking_policies"."min_notice_minutes" >= 0),
	CONSTRAINT "booking_policy_cancel_check" CHECK ("booking_policies"."cancellation_cutoff_minutes" >= 0),
	CONSTRAINT "booking_policy_confirmation_check" CHECK ("booking_policies"."confirmation_mode" IN ('immediate', 'approval'))
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"email" varchar(320),
	"phone" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_contact_required_check" CHECK ("clients"."email" IS NOT NULL OR "clients"."phone" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_professions" (
	"practice_profession_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_professions_practice_profession_id_location_id_pk" PRIMARY KEY("practice_profession_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"name" varchar(140) NOT NULL,
	"address" jsonb,
	"timezone" varchar(64),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_membership_roles" (
	"membership_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_membership_roles_membership_id_role_pk" PRIMARY KEY("membership_id","role")
);
--> statement-breakpoint
CREATE TABLE "practice_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_professions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"profession_code" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"term_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(180) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"public_booking_enabled" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practices_slug_unique" UNIQUE("slug"),
	CONSTRAINT "practices_currency_length_check" CHECK (length("practices"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE "profession_catalog" (
	"code" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"default_terms" jsonb NOT NULL,
	"profile_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_locations" (
	"practice_profession_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_locations_practice_profession_id_user_id_location_id_pk" PRIMARY KEY("practice_profession_id","user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "professional_profiles" (
	"practice_profession_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"headline" varchar(160),
	"bio" text,
	"profile_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_profile" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_profiles_practice_profession_id_user_id_pk" PRIMARY KEY("practice_profession_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "service_locations" (
	"service_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_locations_service_id_location_id_pk" PRIMARY KEY("service_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "service_professionals" (
	"service_id" uuid NOT NULL,
	"professional_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_professionals_service_id_professional_user_id_pk" PRIMARY KEY("service_id","professional_user_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"practice_profession_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"price_minor" integer,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"online_bookable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_duration_positive_check" CHECK ("services"."duration_minutes" > 0),
	CONSTRAINT "services_buffers_nonnegative_check" CHECK ("services"."buffer_before_minutes" >= 0 AND "services"."buffer_after_minutes" >= 0),
	CONSTRAINT "services_price_nonnegative_check" CHECK ("services"."price_minor" IS NULL OR "services"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_professions" ADD CONSTRAINT "location_professions_practice_profession_id_practice_professions_id_fk" FOREIGN KEY ("practice_profession_id") REFERENCES "public"."practice_professions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_professions" ADD CONSTRAINT "location_professions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_membership_roles" ADD CONSTRAINT "practice_membership_roles_membership_id_practice_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."practice_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_memberships" ADD CONSTRAINT "practice_memberships_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_memberships" ADD CONSTRAINT "practice_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_professions" ADD CONSTRAINT "practice_professions_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_locations" ADD CONSTRAINT "professional_locations_practice_profession_id_practice_professions_id_fk" FOREIGN KEY ("practice_profession_id") REFERENCES "public"."practice_professions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_locations" ADD CONSTRAINT "professional_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_locations" ADD CONSTRAINT "professional_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_practice_profession_id_practice_professions_id_fk" FOREIGN KEY ("practice_profession_id") REFERENCES "public"."practice_professions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_practice_profession_id_practice_professions_id_fk" FOREIGN KEY ("practice_profession_id") REFERENCES "public"."practice_professions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_professional_time_idx" ON "appointments" USING btree ("professional_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_practice_time_idx" ON "appointments" USING btree ("practice_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_client_time_idx" ON "appointments" USING btree ("client_id","starts_at");--> statement-breakpoint
CREATE INDEX "audit_practice_created_idx" ON "audit_events" USING btree ("practice_id","created_at");--> statement-breakpoint
CREATE INDEX "availability_exceptions_practice_date_idx" ON "availability_exceptions" USING btree ("practice_id","date");--> statement-breakpoint
CREATE INDEX "availability_lookup_idx" ON "availability_rules" USING btree ("practice_id","weekday","active");--> statement-breakpoint
CREATE INDEX "availability_location_idx" ON "availability_rules" USING btree ("location_id","weekday");--> statement-breakpoint
CREATE INDEX "availability_professional_idx" ON "availability_rules" USING btree ("professional_user_id","weekday");--> statement-breakpoint
CREATE INDEX "clients_practice_email_idx" ON "clients" USING btree ("practice_id","email");--> statement-breakpoint
CREATE INDEX "clients_practice_phone_idx" ON "clients" USING btree ("practice_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_practice_key_uq" ON "idempotency_keys" USING btree ("practice_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_practice_name_uq" ON "locations" USING btree ("practice_id","name");--> statement-breakpoint
CREATE INDEX "locations_practice_active_idx" ON "locations" USING btree ("practice_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_memberships_practice_user_uq" ON "practice_memberships" USING btree ("practice_id","user_id");--> statement-breakpoint
CREATE INDEX "practice_memberships_user_idx" ON "practice_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_professions_code_uq" ON "practice_professions" USING btree ("practice_id","profession_code");--> statement-breakpoint
CREATE INDEX "services_practice_active_idx" ON "services" USING btree ("practice_id","active","online_bookable");--> statement-breakpoint
CREATE INDEX "sessions_user_expiry_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_uq" ON "users" USING btree (lower("email"));
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_no_overlap"
  EXCLUDE USING gist (
    "professional_user_id" WITH =,
    tstzrange("reserved_starts_at", "reserved_ends_at", '[)') WITH &&
  ) WHERE ("status" <> 'cancelled');
--> statement-breakpoint
INSERT INTO "profession_catalog" ("code", "name", "default_terms", "profile_fields")
VALUES (
  'general',
  'General professional practice',
  '{"professionalSingular":"professional","professionalPlural":"professionals","clientSingular":"client","clientPlural":"clients","serviceSingular":"service","servicePlural":"services","appointmentSingular":"appointment","locationSingular":"location"}'::jsonb,
  '[]'::jsonb
);
