CREATE TABLE "org_setting" (
	"org_id" text PRIMARY KEY,
	"group_by_client" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "client_one_default_idx" ON "client" ("org_id") WHERE "is_default";--> statement-breakpoint
ALTER TABLE "org_setting" ADD CONSTRAINT "org_setting_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;