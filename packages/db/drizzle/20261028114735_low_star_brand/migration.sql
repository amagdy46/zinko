ALTER TABLE "audit" ADD COLUMN "baseline_audit_id" uuid;--> statement-breakpoint
ALTER TABLE "audit" ADD COLUMN "kind" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit" ADD COLUMN "narrow_rule_id" text;--> statement-breakpoint
ALTER TABLE "audit" ADD COLUMN "narrow_cells" jsonb;--> statement-breakpoint
ALTER TABLE "audit" ADD COLUMN "narrow_companions" jsonb;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "role" text DEFAULT 'target' NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_org_baseline_idx" ON "audit" ("org_id","baseline_audit_id");--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_baseline_audit_id_audit_id_fkey" FOREIGN KEY ("baseline_audit_id") REFERENCES "audit"("id") ON DELETE SET NULL;