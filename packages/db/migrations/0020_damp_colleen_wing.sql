CREATE TABLE "session_recording_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"storage_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_recording_chunks_index_check" CHECK ("session_recording_chunks"."chunk_index" >= 0),
	CONSTRAINT "session_recording_chunks_size_check" CHECK ("session_recording_chunks"."size_bytes" > 0 AND "session_recording_chunks"."size_bytes" <= 5242880)
);
--> statement-breakpoint
CREATE TABLE "session_recording_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"participant_user_id" uuid NOT NULL,
	"participant_role" varchar(24) NOT NULL,
	"notice_version" varchar(40) NOT NULL,
	"decision" varchar(16) NOT NULL,
	"decided_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_recording_consents_role_check" CHECK ("session_recording_consents"."participant_role" IN ('practitioner','customer')),
	CONSTRAINT "session_recording_consents_decision_check" CHECK ("session_recording_consents"."decision" IN ('pending','accepted','declined','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "session_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"professional_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"storage_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(32) DEFAULT 'awaiting_customer_consent' NOT NULL,
	"sharing_status" varchar(24) DEFAULT 'private' NOT NULL,
	"consent_notice_version" varchar(40) NOT NULL,
	"mime_type" varchar(100),
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"stop_requested_at" timestamp with time zone,
	"retention_expires_at" timestamp with time zone,
	"shared_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_recordings_status_check" CHECK ("session_recordings"."status" IN ('awaiting_customer_consent','declined','ready_to_record','recording','uploading','ready_for_review','shared','stop_requested','failed','deleted','expired')),
	CONSTRAINT "session_recordings_sharing_check" CHECK ("session_recordings"."sharing_status" IN ('private','shared','restricted','expired')),
	CONSTRAINT "session_recordings_size_check" CHECK ("session_recordings"."size_bytes" >= 0 AND "session_recordings"."size_bytes" <= 536870912),
	CONSTRAINT "session_recordings_duration_check" CHECK ("session_recordings"."duration_seconds" IS NULL OR "session_recordings"."duration_seconds" BETWEEN 1 AND 10800)
);
--> statement-breakpoint
ALTER TABLE "session_recording_chunks" ADD CONSTRAINT "session_recording_chunks_recording_id_session_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."session_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recording_consents" ADD CONSTRAINT "session_recording_consents_recording_id_session_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."session_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recording_consents" ADD CONSTRAINT "session_recording_consents_participant_user_id_users_id_fk" FOREIGN KEY ("participant_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_appointment_client_practice_fk" FOREIGN KEY ("appointment_id","practice_id") REFERENCES "public"."appointments"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_client_practice_fk" FOREIGN KEY ("client_id","practice_id") REFERENCES "public"."clients"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_recording_chunks_recording_index_uq" ON "session_recording_chunks" USING btree ("recording_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX "session_recording_chunks_storage_key_uq" ON "session_recording_chunks" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "session_recording_consents_participant_uq" ON "session_recording_consents" USING btree ("recording_id","participant_user_id");--> statement-breakpoint
CREATE INDEX "session_recording_consents_recording_idx" ON "session_recording_consents" USING btree ("recording_id","participant_role","decision");--> statement-breakpoint
CREATE UNIQUE INDEX "session_recordings_storage_key_uq" ON "session_recordings" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "session_recordings_practice_appointment_idx" ON "session_recordings" USING btree ("practice_id","appointment_id","created_at");--> statement-breakpoint
CREATE INDEX "session_recordings_customer_idx" ON "session_recordings" USING btree ("client_id","sharing_status","created_at");--> statement-breakpoint
CREATE INDEX "session_recordings_retention_idx" ON "session_recordings" USING btree ("retention_expires_at") WHERE "session_recordings"."deleted_at" IS NULL;