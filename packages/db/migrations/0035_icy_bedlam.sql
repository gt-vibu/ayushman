ALTER TABLE "clients" ADD COLUMN "merged_into_client_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "merged_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merged_by_user_id_users_id_fk" FOREIGN KEY ("merged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merge_target_practice_fk" FOREIGN KEY ("merged_into_client_id","practice_id") REFERENCES "public"."clients"("id","practice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_practice_merge_idx" ON "clients" USING btree ("practice_id","merged_into_client_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merge_metadata_check" CHECK (("clients"."merged_into_client_id" IS NULL AND "clients"."merged_at" IS NULL) OR ("clients"."merged_into_client_id" IS NOT NULL AND "clients"."merged_at" IS NOT NULL AND "clients"."merged_into_client_id" <> "clients"."id"));