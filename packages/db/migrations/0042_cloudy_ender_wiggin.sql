CREATE TABLE "client_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"responsible_client_id" uuid NOT NULL,
	"dependent_client_id" uuid NOT NULL,
	"relationship" varchar(24) NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_relationship_kind_check" CHECK ("client_relationships"."relationship" IN ('parent', 'guardian', 'caregiver', 'other')),
	CONSTRAINT "client_relationship_distinct_check" CHECK ("client_relationships"."responsible_client_id" <> "client_relationships"."dependent_client_id")
);
--> statement-breakpoint
ALTER TABLE "client_relationships" ADD CONSTRAINT "client_relationships_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_relationships" ADD CONSTRAINT "client_relationships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_relationships" ADD CONSTRAINT "client_relationship_responsible_practice_fk" FOREIGN KEY ("responsible_client_id","practice_id") REFERENCES "public"."clients"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_relationships" ADD CONSTRAINT "client_relationship_dependent_practice_fk" FOREIGN KEY ("dependent_client_id","practice_id") REFERENCES "public"."clients"("id","practice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_relationship_pair_uq" ON "client_relationships" USING btree ("practice_id","responsible_client_id","dependent_client_id");--> statement-breakpoint
CREATE INDEX "client_relationship_dependent_idx" ON "client_relationships" USING btree ("practice_id","dependent_client_id");