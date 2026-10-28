ALTER TABLE "report_edit" ADD COLUMN "include_changes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "report_finding_edit" ADD COLUMN "inherited_from_audit_id" uuid;--> statement-breakpoint
ALTER TABLE "report_finding_edit" ADD COLUMN "inherited_from_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finding_triage" ADD COLUMN "inherited_from_audit_id" uuid;--> statement-breakpoint
ALTER TABLE "finding_triage" ADD COLUMN "inherited_from_at" timestamp with time zone;