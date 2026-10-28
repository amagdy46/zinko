CREATE TABLE "report_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"label" text,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "report_share_org_id_snapshot_id_index" ON "report_share" ("org_id","snapshot_id");--> statement-breakpoint
ALTER TABLE "report_share" ADD CONSTRAINT "report_share_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "report_share" ADD CONSTRAINT "report_share_snapshot_id_report_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "report_snapshot"("id") ON DELETE CASCADE;