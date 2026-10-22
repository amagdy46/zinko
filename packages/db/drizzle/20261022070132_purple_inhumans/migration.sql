CREATE TABLE "check_result" (
	"run_id" uuid,
	"org_id" text NOT NULL,
	"rule_id" text,
	"rules_version" text NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "check_result_pkey" PRIMARY KEY("run_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"audit_id" uuid,
	"org_id" text NOT NULL,
	"rule_id" text,
	"kind" text NOT NULL,
	"rules_versions" text[] NOT NULL,
	"area" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"fix" jsonb NOT NULL,
	"failing_runs" integer NOT NULL,
	"inconclusive_runs" integer NOT NULL,
	"run_ids" uuid[] NOT NULL,
	CONSTRAINT "finding_pkey" PRIMARY KEY("audit_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "finding_triage" (
	"audit_id" uuid,
	"org_id" text NOT NULL,
	"rule_id" text,
	"status" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "finding_triage_pkey" PRIMARY KEY("audit_id","rule_id")
);
--> statement-breakpoint
ALTER TABLE "check_result" ADD CONSTRAINT "check_result_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_audit_id_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finding_triage" ADD CONSTRAINT "finding_triage_audit_id_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE CASCADE;