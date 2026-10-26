ALTER TABLE "practices"
  ADD COLUMN "service_mode" varchar(16) NOT NULL DEFAULT 'both';

ALTER TABLE "practices"
  ADD CONSTRAINT "practices_service_mode_check"
  CHECK ("service_mode" IN ('appointments','walk_ins','both'));

-- Keep walk-in-only practices out of online discovery and booking by default.
UPDATE "practices" SET "public_booking_enabled" = false WHERE "service_mode" = 'walk_ins';
