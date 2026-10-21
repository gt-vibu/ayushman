CREATE TABLE "practice_role_permission_settings" (
	"practice_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"permission_code" varchar(100) NOT NULL,
	"enabled" boolean NOT NULL,
	"scope" "access_scope" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_role_permission_settings_practice_id_role_permission_code_pk" PRIMARY KEY("practice_id","role","permission_code")
);
--> statement-breakpoint
ALTER TABLE "practice_role_permission_settings" ADD CONSTRAINT "practice_role_permission_settings_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_role_permission_settings" ADD CONSTRAINT "practice_role_permission_settings_permission_code_permission_catalog_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permission_catalog"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_role_permission_lookup_idx" ON "practice_role_permission_settings" USING btree ("practice_id","permission_code","role");