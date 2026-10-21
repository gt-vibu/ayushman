CREATE FUNCTION "guard_appointment_status_transition"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'Appointments must start as pending or confirmed';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  IF NOT (
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
--> statement-breakpoint
CREATE FUNCTION "record_appointment_status_event"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_id uuid;
  event_reason varchar(500);
BEGIN
  actor_id := NULLIF(current_setting('app.actor_user_id', true), '')::uuid;
  event_reason := NULLIF(current_setting('app.transition_reason', true), '');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO "appointment_events" ("practice_id", "appointment_id", "from_status", "to_status", "actor_user_id")
    VALUES (NEW."practice_id", NEW."id", NULL, NEW."status", actor_id);
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "appointment_events" ("practice_id", "appointment_id", "from_status", "to_status", "actor_user_id", "reason")
    VALUES (NEW."practice_id", NEW."id", OLD."status", NEW."status", actor_id, COALESCE(NEW."cancellation_reason", event_reason));
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "appointments_guard_status_insert"
BEFORE INSERT ON "appointments"
FOR EACH ROW EXECUTE FUNCTION "guard_appointment_status_transition"();
--> statement-breakpoint
CREATE TRIGGER "appointments_guard_status_update"
BEFORE UPDATE OF "status" ON "appointments"
FOR EACH ROW EXECUTE FUNCTION "guard_appointment_status_transition"();
--> statement-breakpoint
CREATE TRIGGER "appointments_record_initial_status"
AFTER INSERT ON "appointments"
FOR EACH ROW EXECUTE FUNCTION "record_appointment_status_event"();
--> statement-breakpoint
CREATE TRIGGER "appointments_record_status_change"
AFTER UPDATE OF "status" ON "appointments"
FOR EACH ROW EXECUTE FUNCTION "record_appointment_status_event"();
