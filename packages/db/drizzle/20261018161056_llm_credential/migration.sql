CREATE TABLE "llm_credential" (
	"org_id" text PRIMARY KEY,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"base_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_credential" ADD CONSTRAINT "llm_credential_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;