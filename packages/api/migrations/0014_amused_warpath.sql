CREATE TABLE "storage_cleanup" (
	"object_key" text PRIMARY KEY NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "crawl_warning" text;--> statement-breakpoint
ALTER TABLE "index_run_item" ADD COLUMN "prepare_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "index_run_item" ADD COLUMN "embed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "evidence_url" text;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "result_started_at" timestamp;--> statement-breakpoint
CREATE INDEX "storage_cleanup_next_attempt_idx" ON "storage_cleanup" USING btree ("next_attempt_at");