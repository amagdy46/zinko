DROP INDEX "hit_run_vendor_event_idx";--> statement-breakpoint
CREATE INDEX "hit_run_vendor_event_idx" ON "hit" ("run_id","vendor","destination_id","event");