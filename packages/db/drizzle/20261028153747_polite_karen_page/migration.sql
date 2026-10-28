ALTER TABLE "run" ADD COLUMN "follow_host" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "measured_hosts" jsonb DEFAULT '[]' NOT NULL;