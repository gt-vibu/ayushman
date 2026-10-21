CREATE TYPE "public"."invoice_kind" AS ENUM('tax_invoice', 'bill_of_supply', 'receipt');--> statement-breakpoint
CREATE TYPE "public"."invoice_payment_method" AS ENUM('cash', 'card', 'bank_transfer', 'upi', 'insurance', 'other');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'partially_paid', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."invoice_tax_mode" AS ENUM('none', 'cgst_sgst', 'igst');--> statement-breakpoint
CREATE TABLE "billing_profiles" (
	"practice_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" varchar(180),
	"gstin" varchar(15),
	"address" jsonb,
	"email" varchar(320),
	"phone" varchar(32),
	"invoice_prefix" varchar(12) DEFAULT 'INV' NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_profiles_gstin_format_check" CHECK ("billing_profiles"."gstin" IS NULL OR "billing_profiles"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "client_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"appointment_id" uuid,
	"location_id" uuid,
	"uploaded_by_user_id" uuid NOT NULL,
	"storage_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"original_name" varchar(240) NOT NULL,
	"media_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"category" varchar(40) NOT NULL,
	"description" varchar(500),
	"customer_visible" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_documents_size_positive_check" CHECK ("client_documents"."size_bytes" > 0 AND "client_documents"."size_bytes" <= 20971520)
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" varchar(500) NOT NULL,
	"sac_code" varchar(12),
	"quantity_milli" integer DEFAULT 1000 NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"line_total_minor" integer NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"line_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_items_values_check" CHECK ("invoice_items"."quantity_milli" > 0 AND "invoice_items"."unit_price_minor" >= 0 AND "invoice_items"."line_total_minor" >= 0 AND "invoice_items"."tax_rate_bps" >= 0 AND "invoice_items"."tax_minor" >= 0 AND "invoice_items"."line_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"method" "invoice_payment_method" NOT NULL,
	"reference" varchar(120),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_amount_positive_check" CHECK ("invoice_payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"practice_id" uuid NOT NULL,
	"financial_year" varchar(7) NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_sequences_number_check" CHECK ("invoice_sequences"."last_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"appointment_id" uuid,
	"location_id" uuid,
	"invoice_number" varchar(32) NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"issue_date" varchar(10) NOT NULL,
	"due_date" varchar(10),
	"supplier_snapshot" jsonb NOT NULL,
	"recipient_snapshot" jsonb NOT NULL,
	"place_of_supply" varchar(120),
	"sac_code" varchar(12),
	"tax_mode" "invoice_tax_mode" DEFAULT 'none' NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"central_tax_minor" integer DEFAULT 0 NOT NULL,
	"state_tax_minor" integer DEFAULT 0 NOT NULL,
	"integrated_tax_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"amount_paid_minor" integer DEFAULT 0 NOT NULL,
	"notes" varchar(1000),
	"issued_by_user_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amounts_nonnegative_check" CHECK ("invoices"."subtotal_minor" >= 0 AND "invoices"."discount_minor" >= 0 AND "invoices"."tax_minor" >= 0 AND "invoices"."total_minor" >= 0 AND "invoices"."amount_paid_minor" >= 0 AND "invoices"."amount_paid_minor" <= "invoices"."total_minor"),
	CONSTRAINT "invoices_due_after_issue_check" CHECK ("invoices"."due_date" IS NULL OR "invoices"."due_date" >= "invoices"."issue_date"),
	CONSTRAINT "invoices_void_metadata_check" CHECK (("invoices"."status" = 'void' AND "invoices"."voided_at" IS NOT NULL) OR ("invoices"."status" <> 'void' AND "invoices"."voided_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_id_practice_uq" ON "invoices" USING btree ("id","practice_id");--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_client_practice_fk" FOREIGN KEY ("client_id","practice_id") REFERENCES "public"."clients"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_practice_fk" FOREIGN KEY ("invoice_id","practice_id") REFERENCES "public"."invoices"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_practice_fk" FOREIGN KEY ("invoice_id","practice_id") REFERENCES "public"."invoices"("id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_practice_fk" FOREIGN KEY ("client_id","practice_id") REFERENCES "public"."clients"("id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_documents_practice_client_created_idx" ON "client_documents" USING btree ("practice_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "client_documents_client_visibility_idx" ON "client_documents" USING btree ("client_id","customer_visible","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_documents_storage_key_uq" ON "client_documents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("practice_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("practice_id","invoice_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_sequences_practice_year_uq" ON "invoice_sequences" USING btree ("practice_id","financial_year");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_practice_number_uq" ON "invoices" USING btree ("practice_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_practice_issue_idx" ON "invoices" USING btree ("practice_id","issue_date");--> statement-breakpoint
CREATE INDEX "invoices_client_issue_idx" ON "invoices" USING btree ("client_id","issue_date");--> statement-breakpoint
INSERT INTO "permission_catalog" ("code", "description", "sensitive") VALUES
  ('billing.read', 'View invoices and billing settings', false),
  ('billing.manage', 'Issue invoices and manage billing settings and payments', true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permission_grants" ("role", "permission_code", "scope") VALUES
  ('owner'::"membership_role", 'billing.read', 'practice'::"access_scope"),
  ('owner'::"membership_role", 'billing.manage', 'practice'::"access_scope"),
  ('admin'::"membership_role", 'billing.read', 'practice'::"access_scope"),
  ('admin'::"membership_role", 'billing.manage', 'practice'::"access_scope")
ON CONFLICT ("role", "permission_code") DO NOTHING;
