CREATE TYPE "public"."platform_role" AS ENUM('superadmin', 'support');--> statement-breakpoint
CREATE TABLE "platform_membership_roles" (
	"membership_id" uuid NOT NULL,
	"role" "platform_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_membership_roles_membership_id_role_pk" PRIMARY KEY("membership_id","role")
);
--> statement-breakpoint
CREATE TABLE "platform_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"granted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_memberships_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "platform_permission_catalog" (
	"code" varchar(100) PRIMARY KEY NOT NULL,
	"description" varchar(240) NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_role_permission_grants" (
	"role" "platform_role" NOT NULL,
	"permission_code" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_role_permission_grants_role_permission_code_pk" PRIMARY KEY("role","permission_code")
);
--> statement-breakpoint
ALTER TABLE "platform_membership_roles" ADD CONSTRAINT "platform_membership_roles_membership_id_platform_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."platform_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_memberships" ADD CONSTRAINT "platform_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_memberships" ADD CONSTRAINT "platform_memberships_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_role_permission_grants" ADD CONSTRAINT "platform_role_permission_grants_permission_code_platform_permission_catalog_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."platform_permission_catalog"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_memberships_status_idx" ON "platform_memberships" USING btree ("status","user_id");--> statement-breakpoint
CREATE INDEX "platform_role_permission_lookup_idx" ON "platform_role_permission_grants" USING btree ("permission_code","role");
--> statement-breakpoint
INSERT INTO "platform_permission_catalog" ("code", "description", "sensitive") VALUES
  ('platform.practices.read', 'View platform practice accounts', false),
  ('platform.practices.manage', 'Manage platform practice accounts', true),
  ('platform.users.read', 'View platform user accounts', false),
  ('platform.users.disable', 'Disable platform user accounts', true),
  ('platform.audit.read', 'View platform audit records', true),
  ('platform.settings.manage', 'Manage platform-wide settings', true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_role_permission_grants" ("role", "permission_code") VALUES
  ('superadmin'::"platform_role", 'platform.practices.read'),
  ('superadmin'::"platform_role", 'platform.practices.manage'),
  ('superadmin'::"platform_role", 'platform.users.read'),
  ('superadmin'::"platform_role", 'platform.users.disable'),
  ('superadmin'::"platform_role", 'platform.audit.read'),
  ('superadmin'::"platform_role", 'platform.settings.manage'),
  ('support'::"platform_role", 'platform.practices.read'),
  ('support'::"platform_role", 'platform.users.read')
ON CONFLICT ("role", "permission_code") DO NOTHING;
