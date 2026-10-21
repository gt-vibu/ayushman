DROP INDEX "appointments_hold_expiry_idx";--> statement-breakpoint
CREATE INDEX "appointments_hold_expiry_idx" ON "appointments" USING btree ("status","hold_expires_at");