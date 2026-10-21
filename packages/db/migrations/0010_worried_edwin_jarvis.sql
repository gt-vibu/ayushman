CREATE TABLE "staff_invitation_locations" (
	"practice_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitation_locations_invitation_id_location_id_pk" PRIMARY KEY("invitation_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "staff_invitation_roles" (
	"invitation_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitation_roles_invitation_id_role_pk" PRIMARY KEY("invitation_id","role")
);
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "staff_invitation_locations_location_idx" ON "staff_invitation_locations" USING btree ("location_id","invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_id_practice_uq" ON "staff_invitations" USING btree ("id","practice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitation_active_email_uq" ON "staff_invitations" USING btree ("practice_id",lower("email")) WHERE "staff_invitations"."accepted_at" IS NULL AND "staff_invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "staff_invitations_practice_expiry_idx" ON "staff_invitations" USING btree ("practice_id","expires_at");--> statement-breakpoint
ALTER TABLE "staff_invitation_locations" ADD CONSTRAINT "staff_invitation_locations_invitation_practice_fk" FOREIGN KEY ("invitation_id","practice_id") REFERENCES "public"."staff_invitations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation_locations" ADD CONSTRAINT "staff_invitation_locations_location_practice_fk" FOREIGN KEY ("location_id","practice_id") REFERENCES "public"."locations"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation_roles" ADD CONSTRAINT "staff_invitation_roles_invitation_id_staff_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."staff_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
