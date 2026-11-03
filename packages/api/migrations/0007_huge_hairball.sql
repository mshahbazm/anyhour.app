ALTER TABLE "index_run" ADD COLUMN "phase" text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "crawl_provider" text;--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "crawl_job_id" text;--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "crawl_cursor" text;--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "crawl_collected_at" timestamp;--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "next_crawl_check_at" timestamp;--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "crawl_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "index_run_item" ADD COLUMN "staged_content_key" text;--> statement-breakpoint
ALTER TABLE "index_run_item" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "index_run_item" ADD COLUMN "lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "index_run_item" ADD COLUMN "last_error" text;