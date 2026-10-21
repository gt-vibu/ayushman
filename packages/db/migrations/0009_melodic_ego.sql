ALTER TABLE "service_locations" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service_professionals" ADD COLUMN "active" boolean DEFAULT true NOT NULL;