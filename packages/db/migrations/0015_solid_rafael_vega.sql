CREATE TABLE "appointment_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"kind" varchar(40) DEFAULT 'new_booking' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "follow_up_to_appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "appointment_notifications" ADD CONSTRAINT "appointment_notifications_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_notifications" ADD CONSTRAINT "appointment_notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_notifications" ADD CONSTRAINT "appointment_notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_notifications" ADD CONSTRAINT "appointment_notifications_appointment_practice_fk" FOREIGN KEY ("appointment_id","practice_id") REFERENCES "public"."appointments"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_notifications_recipient_appointment_uq" ON "appointment_notifications" USING btree ("recipient_user_id","appointment_id","kind");--> statement-breakpoint
CREATE INDEX "appointment_notifications_inbox_idx" ON "appointment_notifications" USING btree ("recipient_user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "appointment_notifications_practice_idx" ON "appointment_notifications" USING btree ("practice_id","created_at");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_follow_up_parent_practice_fk" FOREIGN KEY ("follow_up_to_appointment_id","practice_id") REFERENCES "public"."appointments"("id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_follow_up_parent_idx" ON "appointments" USING btree ("follow_up_to_appointment_id");