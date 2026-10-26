CREATE OR REPLACE FUNCTION "guard_cross_practice_professional_overlap"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" NOT IN ('held', 'pending', 'confirmed', 'checked_in', 'in_progress') THEN
    RETURN NEW;
  END IF;

  -- Serialize appointments for this user across practices. The in-practice
  -- exclusion constraint remains the final guard within one practice.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."professional_user_id"::text, 0));

  IF EXISTS (
    SELECT 1
    FROM "appointments" existing
    WHERE existing."professional_user_id" = NEW."professional_user_id"
      AND existing."id" <> NEW."id"
      AND existing."status" IN ('held', 'pending', 'confirmed', 'checked_in', 'in_progress')
      AND (existing."status" <> 'held' OR existing."hold_expires_at" > now())
      AND existing."reserved_starts_at" < NEW."reserved_ends_at"
      AND existing."reserved_ends_at" > NEW."reserved_starts_at"
  ) THEN
    RAISE EXCEPTION 'Practitioner is not available for this time'
      USING ERRCODE = '23P01', CONSTRAINT = 'appointments_professional_global_overlap';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "appointments_guard_cross_practice_overlap"
BEFORE INSERT OR UPDATE OF "professional_user_id", "reserved_starts_at", "reserved_ends_at", "status"
ON "appointments"
FOR EACH ROW EXECUTE FUNCTION "guard_cross_practice_professional_overlap"();
