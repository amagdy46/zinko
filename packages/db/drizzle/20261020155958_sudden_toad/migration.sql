CREATE TABLE "audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"site_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"workflow_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "datalayer_push" (
	"org_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"seq" integer,
	"document_id" text NOT NULL,
	"at" integer NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "datalayer_push_pkey" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "hit" (
	"org_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"request_id" text,
	"batch_index" integer,
	"document_id" text NOT NULL,
	"at" integer NOT NULL,
	"vendor" text NOT NULL,
	"destination_id" text NOT NULL,
	"event" text NOT NULL,
	"params" jsonb NOT NULL,
	"ids" jsonb NOT NULL,
	"consent" jsonb NOT NULL,
	"host" text NOT NULL,
	"url" text NOT NULL,
	"blocked" boolean NOT NULL,
	"status" integer,
	"after_consent_action" boolean NOT NULL,
	CONSTRAINT "hit_pkey" PRIMARY KEY("run_id","request_id","batch_index")
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_id" uuid NOT NULL,
	"failure" text,
	"ordinal" integer NOT NULL,
	"page_url" text NOT NULL,
	"scenario" text NOT NULL,
	"viewport" text NOT NULL,
	"status" text NOT NULL,
	"engine" jsonb,
	"decoder_version" text,
	"consent" jsonb,
	"documents" jsonb,
	"cookies" jsonb,
	"errors" jsonb,
	"complete" boolean,
	"truncated" boolean,
	"screenshot_key" text,
	"capture_key" text,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_audit_ordinal_unique" UNIQUE("audit_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"org_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"host" text NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "audit_org_site_created_idx" ON "audit" ("org_id","site_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "client_org_archived_idx" ON "client" ("org_id","archived_at");--> statement-breakpoint
CREATE INDEX "datalayer_push_run_at_idx" ON "datalayer_push" ("run_id","at","seq");--> statement-breakpoint
CREATE INDEX "hit_run_at_idx" ON "hit" ("run_id","at","request_id","batch_index");--> statement-breakpoint
CREATE INDEX "hit_run_vendor_event_idx" ON "hit" ("run_id","vendor","event");--> statement-breakpoint
CREATE INDEX "run_audit_ordinal_idx" ON "run" ("audit_id","ordinal");--> statement-breakpoint
CREATE INDEX "site_org_client_idx" ON "site" ("org_id","client_id");--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_site_id_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "datalayer_push" ADD CONSTRAINT "datalayer_push_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "hit" ADD CONSTRAINT "hit_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_audit_id_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT;