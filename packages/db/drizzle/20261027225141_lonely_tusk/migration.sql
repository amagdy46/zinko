CREATE TABLE "explain_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"generation_id" uuid NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "finding_explanation" (
	"org_id" text,
	"rule_id" text,
	"rules_versions" text,
	"evidence_hash" text,
	"prompt_version" text,
	"policy_id" text,
	"provider" text,
	"model" text,
	"endpoint_id" text,
	"explanation" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_explanation_pkey" PRIMARY KEY("org_id","rule_id","rules_versions","evidence_hash","prompt_version","policy_id","provider","model","endpoint_id")
);
--> statement-breakpoint
CREATE INDEX "explain_usage_org_reserved_idx" ON "explain_usage" ("org_id","reserved_at");--> statement-breakpoint
CREATE INDEX "explain_usage_org_key_reserved_idx" ON "explain_usage" ("org_id","key_hash","reserved_at");--> statement-breakpoint
ALTER TABLE "explain_usage" ADD CONSTRAINT "explain_usage_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finding_explanation" ADD CONSTRAINT "finding_explanation_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;