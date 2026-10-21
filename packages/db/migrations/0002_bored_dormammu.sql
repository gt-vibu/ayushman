CREATE UNIQUE INDEX "clients_id_practice_uq" ON "clients" USING btree ("id","practice_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_practice_fk" FOREIGN KEY ("service_id","practice_id") REFERENCES "public"."services"("id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_practice_fk" FOREIGN KEY ("client_id","practice_id") REFERENCES "public"."clients"("id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_membership_fk" FOREIGN KEY ("practice_id","professional_user_id") REFERENCES "public"."practice_memberships"("practice_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_location_time_idx" ON "appointments" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_professions_id_practice_uq" ON "practice_professions" USING btree ("id","practice_id");--> statement-breakpoint
CREATE INDEX "services_profession_active_idx" ON "services" USING btree ("practice_profession_id","active");
