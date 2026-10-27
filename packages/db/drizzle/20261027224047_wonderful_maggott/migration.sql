CREATE TABLE "ai_policy" (
	"org_id" text PRIMARY KEY,
	"explanations_enabled" boolean DEFAULT false NOT NULL,
	"include_page_paths" boolean DEFAULT false NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_policy" ADD CONSTRAINT "ai_policy_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;