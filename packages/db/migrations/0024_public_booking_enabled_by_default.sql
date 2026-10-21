ALTER TABLE "practices" ALTER COLUMN "public_booking_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "practices" ALTER COLUMN "public_listing_enabled" SET DEFAULT true;--> statement-breakpoint

-- Practices that already exist and are active should follow the new default.
-- Owners can still disable either setting independently in Practice Settings.
UPDATE "practices"
SET "public_booking_enabled" = true,
    "public_listing_enabled" = true,
    "updated_at" = now()
WHERE "active" = true
  AND ("public_booking_enabled" = false OR "public_listing_enabled" = false);
