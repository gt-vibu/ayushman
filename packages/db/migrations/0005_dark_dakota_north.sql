CREATE INDEX "practices_public_discovery_idx" ON "practices" USING btree ("active","public_listing_enabled","slug");
--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_practice_no_overlap"
  EXCLUDE USING gist (
    "practice_id" WITH =,
    "weekday" WITH =,
    int4range("start_minute", "end_minute", '[)') WITH &&
  ) WHERE ("scope" = 'practice' AND "active");
--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_location_no_overlap"
  EXCLUDE USING gist (
    "practice_id" WITH =,
    "location_id" WITH =,
    "weekday" WITH =,
    int4range("start_minute", "end_minute", '[)') WITH &&
  ) WHERE ("scope" = 'location' AND "active");
--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_professional_no_overlap"
  EXCLUDE USING gist (
    "practice_id" WITH =,
    "practice_profession_id" WITH =,
    "professional_user_id" WITH =,
    "weekday" WITH =,
    int4range("start_minute", "end_minute", '[)') WITH &&
  ) WHERE ("scope" = 'professional' AND "active");
--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_professional_location_no_overlap"
  EXCLUDE USING gist (
    "practice_id" WITH =,
    "practice_profession_id" WITH =,
    "professional_user_id" WITH =,
    "location_id" WITH =,
    "weekday" WITH =,
    int4range("start_minute", "end_minute", '[)') WITH &&
  ) WHERE ("scope" = 'professional_location' AND "active");
