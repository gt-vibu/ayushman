ALTER TABLE "professional_locations"
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
