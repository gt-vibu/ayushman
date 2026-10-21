DROP INDEX "appointments_professional_time_idx";--> statement-breakpoint
DROP INDEX "appointments_practice_time_idx";--> statement-breakpoint
CREATE INDEX "availability_exceptions_location_date_idx" ON "availability_exceptions" USING btree ("location_id","date");--> statement-breakpoint
CREATE INDEX "availability_exceptions_professional_date_idx" ON "availability_exceptions" USING btree ("professional_user_id","date");--> statement-breakpoint
CREATE INDEX "location_professions_location_idx" ON "location_professions" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_id_practice_uq" ON "locations" USING btree ("id","practice_id");--> statement-breakpoint
CREATE INDEX "professional_locations_user_idx" ON "professional_locations" USING btree ("user_id","location_id");--> statement-breakpoint
CREATE INDEX "professional_locations_location_idx" ON "professional_locations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "professional_profiles_user_idx" ON "professional_profiles" USING btree ("user_id","public_profile");--> statement-breakpoint
CREATE INDEX "service_locations_location_idx" ON "service_locations" USING btree ("location_id","service_id");--> statement-breakpoint
CREATE INDEX "service_professionals_professional_idx" ON "service_professionals" USING btree ("professional_user_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_id_practice_uq" ON "services" USING btree ("id","practice_id");--> statement-breakpoint
CREATE INDEX "appointments_professional_time_idx" ON "appointments" USING btree ("professional_user_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_practice_time_idx" ON "appointments" USING btree ("practice_id","status","starts_at");