ALTER TABLE "knowledge_source" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "delete_after" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "next_archive_check_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "content_deleted_at" timestamp;--> statement-breakpoint
CREATE INDEX "knowledge_source_archive_check_idx" ON "knowledge_source" USING btree ("next_archive_check_at");