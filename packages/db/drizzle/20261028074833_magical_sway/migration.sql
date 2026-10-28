CREATE TABLE "org_branding" (
	"org_id" text PRIMARY KEY,
	"agency_name" text NOT NULL,
	"accent" text NOT NULL,
	"footer_text" text,
	"show_powered_by" boolean DEFAULT true NOT NULL,
	"logo_key" text,
	"logo_type" text,
	"logo_sha256" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_branding" ADD CONSTRAINT "org_branding_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;