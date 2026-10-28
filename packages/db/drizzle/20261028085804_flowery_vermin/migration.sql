CREATE TABLE "report_file_cleanup" (
	"org_id" text,
	"key" text,
	CONSTRAINT "report_file_cleanup_pkey" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "report_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"audit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"model_version" integer NOT NULL,
	"model" jsonb NOT NULL,
	"publication_hash" text NOT NULL,
	"logo_key" text,
	"logo_type" text,
	"logo_sha256" text,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_snapshot_audit_id_version_unique" UNIQUE("audit_id","version")
);
--> statement-breakpoint
ALTER TABLE "audit" ADD COLUMN "report_version_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "report_snapshot_org_id_audit_id_index" ON "report_snapshot" ("org_id","audit_id");--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD CONSTRAINT "report_snapshot_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD CONSTRAINT "report_snapshot_audit_id_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE CASCADE;