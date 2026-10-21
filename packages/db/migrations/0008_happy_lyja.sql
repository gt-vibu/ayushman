CREATE TYPE "public"."access_scope" AS ENUM('practice', 'assigned_locations', 'own');--> statement-breakpoint
CREATE TYPE "public"."permission_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TABLE "practice_membership_locations" (
	"practice_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_membership_locations_membership_id_location_id_pk" PRIMARY KEY("membership_id","location_id")
);--> statement-breakpoint
CREATE TABLE "membership_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"permission_code" varchar(100) NOT NULL,
	"location_id" uuid,
	"effect" "permission_effect" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "permission_catalog" (
	"code" varchar(100) PRIMARY KEY NOT NULL,
	"description" varchar(240) NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "role_permission_grants" (
	"role" "membership_role" NOT NULL,
	"permission_code" varchar(100) NOT NULL,
	"scope" "access_scope" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permission_grants_role_permission_code_pk" PRIMARY KEY("role","permission_code")
);--> statement-breakpoint
CREATE INDEX "membership_locations_location_idx" ON "practice_membership_locations" USING btree ("location_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_permission_practice_uq" ON "membership_permission_overrides" USING btree ("membership_id","permission_code") WHERE "membership_permission_overrides"."location_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_permission_location_uq" ON "membership_permission_overrides" USING btree ("membership_id","permission_code","location_id") WHERE "membership_permission_overrides"."location_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "membership_permissions_lookup_idx" ON "membership_permission_overrides" USING btree ("practice_id","membership_id","permission_code");--> statement-breakpoint
CREATE INDEX "role_permission_code_idx" ON "role_permission_grants" USING btree ("permission_code","role");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_memberships_practice_id_uq" ON "practice_memberships" USING btree ("practice_id","id");--> statement-breakpoint
ALTER TABLE "practice_membership_locations" ADD CONSTRAINT "membership_locations_membership_practice_fk" FOREIGN KEY ("practice_id","membership_id") REFERENCES "public"."practice_memberships"("practice_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_membership_locations" ADD CONSTRAINT "membership_locations_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_permission_code_permission_catalog_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permission_catalog"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permissions_membership_practice_fk" FOREIGN KEY ("practice_id","membership_id") REFERENCES "public"."practice_memberships"("practice_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permissions_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission_grants" ADD CONSTRAINT "role_permission_grants_permission_code_permission_catalog_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permission_catalog"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "permission_catalog" ("code","description","sensitive") VALUES
  ('practice.read','View practice details',false),
  ('practice.update','Update practice settings',false),
  ('locations.read','View branches',false),
  ('locations.manage','Create and manage branches',false),
  ('staff.read','View practice staff',false),
  ('staff.manage','Invite staff and manage their roles',false),
  ('services.read','View services',false),
  ('services.manage','Create and manage services',false),
  ('availability.read','View opening hours and availability',false),
  ('availability.manage','Configure opening hours and professional availability',false),
  ('booking_policy.read','View booking policies',false),
  ('booking_policy.manage','Configure booking policies',false),
  ('appointments.read','View appointments',false),
  ('appointments.create','Create appointments',false),
  ('appointments.update','Update appointments',false),
  ('appointments.cancel','Cancel appointments',false),
  ('appointments.check_in','Check clients in',false),
  ('appointments.complete','Complete appointments',false),
  ('appointments.mark_no_show','Mark appointments as no-show',false),
  ('clients.read','View client profiles',false),
  ('clients.create','Create client profiles',false),
  ('clients.update','Update client profiles',false),
  ('records.read','View private client records',true),
  ('records.write','Create and update private client records',true),
  ('audit.read','View practice audit history',true),
  ('professional_profile.manage_self','Manage own professional profile',false)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permission_grants" ("role","permission_code","scope") VALUES
  ('owner'::"membership_role",'practice.read','practice'::"access_scope"),
  ('owner'::"membership_role",'practice.update','practice'::"access_scope"),
  ('owner'::"membership_role",'locations.read','practice'::"access_scope"),
  ('owner'::"membership_role",'locations.manage','practice'::"access_scope"),
  ('owner'::"membership_role",'staff.read','practice'::"access_scope"),
  ('owner'::"membership_role",'staff.manage','practice'::"access_scope"),
  ('owner'::"membership_role",'services.read','practice'::"access_scope"),
  ('owner'::"membership_role",'services.manage','practice'::"access_scope"),
  ('owner'::"membership_role",'availability.read','practice'::"access_scope"),
  ('owner'::"membership_role",'availability.manage','practice'::"access_scope"),
  ('owner'::"membership_role",'booking_policy.read','practice'::"access_scope"),
  ('owner'::"membership_role",'booking_policy.manage','practice'::"access_scope"),
  ('owner'::"membership_role",'appointments.read','practice'::"access_scope"),
  ('owner'::"membership_role",'appointments.create','practice'::"access_scope"),
  ('owner'::"membership_role",'appointments.update','practice'::"access_scope"),
  ('owner'::"membership_role",'appointments.cancel','practice'::"access_scope"),
  ('owner'::"membership_role",'appointments.check_in','practice'::"access_scope"),
  ('owner'::"membership_role",'appointments.complete','practice'::"access_scope"),
  ('owner'::"membership_role",'appointments.mark_no_show','practice'::"access_scope"),
  ('owner'::"membership_role",'clients.read','practice'::"access_scope"),
  ('owner'::"membership_role",'clients.create','practice'::"access_scope"),
  ('owner'::"membership_role",'clients.update','practice'::"access_scope"),
  ('owner'::"membership_role",'records.read','practice'::"access_scope"),
  ('owner'::"membership_role",'records.write','practice'::"access_scope"),
  ('owner'::"membership_role",'audit.read','practice'::"access_scope"),
  ('owner'::"membership_role",'professional_profile.manage_self','practice'::"access_scope"),
  ('admin'::"membership_role",'practice.read','practice'::"access_scope"),
  ('admin'::"membership_role",'practice.update','practice'::"access_scope"),
  ('admin'::"membership_role",'locations.read','practice'::"access_scope"),
  ('admin'::"membership_role",'locations.manage','practice'::"access_scope"),
  ('admin'::"membership_role",'staff.read','practice'::"access_scope"),
  ('admin'::"membership_role",'staff.manage','practice'::"access_scope"),
  ('admin'::"membership_role",'services.read','practice'::"access_scope"),
  ('admin'::"membership_role",'services.manage','practice'::"access_scope"),
  ('admin'::"membership_role",'availability.read','practice'::"access_scope"),
  ('admin'::"membership_role",'availability.manage','practice'::"access_scope"),
  ('admin'::"membership_role",'booking_policy.read','practice'::"access_scope"),
  ('admin'::"membership_role",'booking_policy.manage','practice'::"access_scope"),
  ('admin'::"membership_role",'appointments.read','practice'::"access_scope"),
  ('admin'::"membership_role",'appointments.create','practice'::"access_scope"),
  ('admin'::"membership_role",'appointments.update','practice'::"access_scope"),
  ('admin'::"membership_role",'appointments.cancel','practice'::"access_scope"),
  ('admin'::"membership_role",'appointments.check_in','practice'::"access_scope"),
  ('admin'::"membership_role",'appointments.complete','practice'::"access_scope"),
  ('admin'::"membership_role",'appointments.mark_no_show','practice'::"access_scope"),
  ('admin'::"membership_role",'clients.read','practice'::"access_scope"),
  ('admin'::"membership_role",'clients.create','practice'::"access_scope"),
  ('admin'::"membership_role",'clients.update','practice'::"access_scope"),
  ('professional'::"membership_role",'practice.read','practice'::"access_scope"),
  ('professional'::"membership_role",'locations.read','own'::"access_scope"),
  ('professional'::"membership_role",'services.read','own'::"access_scope"),
  ('professional'::"membership_role",'availability.read','own'::"access_scope"),
  ('professional'::"membership_role",'appointments.read','own'::"access_scope"),
  ('professional'::"membership_role",'appointments.create','own'::"access_scope"),
  ('professional'::"membership_role",'appointments.update','own'::"access_scope"),
  ('professional'::"membership_role",'appointments.cancel','own'::"access_scope"),
  ('professional'::"membership_role",'appointments.complete','own'::"access_scope"),
  ('professional'::"membership_role",'clients.read','own'::"access_scope"),
  ('professional'::"membership_role",'records.read','own'::"access_scope"),
  ('professional'::"membership_role",'records.write','own'::"access_scope"),
  ('professional'::"membership_role",'professional_profile.manage_self','own'::"access_scope"),
  ('scheduler'::"membership_role",'practice.read','practice'::"access_scope"),
  ('scheduler'::"membership_role",'locations.read','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'staff.read','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'services.read','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'availability.read','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'booking_policy.read','practice'::"access_scope"),
  ('scheduler'::"membership_role",'appointments.read','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'appointments.create','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'appointments.update','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'appointments.cancel','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'appointments.check_in','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'appointments.mark_no_show','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'clients.read','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'clients.create','assigned_locations'::"access_scope"),
  ('scheduler'::"membership_role",'clients.update','assigned_locations'::"access_scope")
ON CONFLICT ("role","permission_code") DO NOTHING;
