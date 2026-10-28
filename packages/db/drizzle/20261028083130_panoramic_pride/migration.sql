CREATE TABLE "report_edit" (
	"audit_id" uuid PRIMARY KEY,
	"org_id" text NOT NULL,
	"summary" text,
	"detail" text DEFAULT 'standard' NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_finding_edit" (
	"audit_id" uuid,
	"org_id" text NOT NULL,
	"rule_id" text,
	"note" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"owner" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_finding_edit_pkey" PRIMARY KEY("audit_id","rule_id")
);
--> statement-breakpoint
ALTER TABLE "report_edit" ADD CONSTRAINT "report_edit_audit_id_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "report_edit" ADD CONSTRAINT "report_edit_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "report_finding_edit" ADD CONSTRAINT "report_finding_edit_audit_id_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "report_finding_edit" ADD CONSTRAINT "report_finding_edit_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;