ALTER TABLE "clients"
  ADD COLUMN "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "appointments"
  ADD COLUMN "is_walk_in" boolean NOT NULL DEFAULT false,
  ADD COLUMN "visit_description" varchar(1000),
  ADD COLUMN "amount_paid_minor" integer NOT NULL DEFAULT 0,
  ADD COLUMN "payment_method" varchar(24);

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_payment_values_check"
  CHECK ("amount_paid_minor" >= 0 AND ("payment_method" IS NULL OR "payment_method" IN ('cash','upi','card','bank_transfer','insurance','other')));
