ALTER TYPE "public"."appointment_status" ADD VALUE 'interrupted' BEFORE 'no_show';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_appointment_status_transition"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_id uuid;
  correction_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" NOT IN ('held', 'pending', 'confirmed') AND NOT (
      NEW."status" = 'completed'
      AND NEW."is_walk_in" = true
      AND NEW."actual_arrived_at" IS NOT NULL
      AND NEW."actual_started_at" IS NOT NULL
      AND NEW."actual_ended_at" IS NOT NULL
      AND NEW."actual_arrived_at" <= NEW."actual_started_at"
      AND NEW."actual_started_at" <= NEW."actual_ended_at"
    ) THEN
      RAISE EXCEPTION 'Appointments must start as held, pending or confirmed; completed is reserved for an explicitly entered historical walk-in';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  correction_reason := NULLIF(current_setting('app.transition_reason', true), '');
  IF current_setting('app.status_correction', true) = 'true'
    AND correction_reason IS NOT NULL
    AND ((OLD."status" = 'no_show' AND NEW."status" IN ('confirmed', 'checked_in', 'in_progress', 'completed'))
      OR (OLD."status" = 'completed' AND NEW."status" IN ('checked_in', 'in_progress'))
      OR (OLD."status" = 'interrupted' AND NEW."status" = 'in_progress')) THEN
    RETURN NEW;
  END IF;

  IF NEW."status" = 'interrupted' AND OLD."status" IN ('checked_in', 'in_progress')
    AND OLD."actual_started_at" IS NOT NULL AND correction_reason IS NOT NULL THEN
    NEW."actual_ended_at" := COALESCE(NEW."actual_ended_at", now());
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'held' AND NEW."status" IN ('confirmed', 'cancelled')) OR
    (OLD."status" = 'pending' AND NEW."status" IN ('confirmed', 'cancelled')) OR
    (OLD."status" = 'confirmed' AND NEW."status" IN ('checked_in', 'cancelled', 'no_show')) OR
    (OLD."status" = 'checked_in' AND NEW."status" IN ('in_progress', 'completed')) OR
    (OLD."status" = 'in_progress' AND NEW."status" = 'completed')
  ) THEN
    RAISE EXCEPTION 'Invalid appointment status transition: % -> %', OLD."status", NEW."status";
  END IF;

  IF NEW."status" = 'cancelled' THEN
    NEW."cancelled_at" := COALESCE(NEW."cancelled_at", now());
    actor_id := NULLIF(current_setting('app.actor_user_id', true), '')::uuid;
    NEW."cancelled_by_user_id" := COALESCE(NEW."cancelled_by_user_id", actor_id);
  END IF;

  RETURN NEW;
END;
$$;
