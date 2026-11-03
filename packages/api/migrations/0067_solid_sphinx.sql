ALTER TABLE "index_run" DROP CONSTRAINT "index_run_assistant_id_assistant_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_chunk" DROP CONSTRAINT "knowledge_chunk_assistant_id_assistant_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_correction" DROP CONSTRAINT "knowledge_correction_assistant_id_assistant_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_shared_block" DROP CONSTRAINT "knowledge_shared_block_assistant_id_assistant_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_source" DROP CONSTRAINT "knowledge_source_assistant_id_assistant_id_fk";
--> statement-breakpoint
DROP INDEX "assistant_lead_idx";--> statement-breakpoint
DROP INDEX "index_run_owner_idx";--> statement-breakpoint
DROP INDEX "knowledge_chunk_owner_idx";--> statement-breakpoint
DROP INDEX "knowledge_correction_owner_status_idx";--> statement-breakpoint
DROP INDEX "knowledge_shared_block_owner_idx";--> statement-breakpoint
DROP INDEX "knowledge_source_owner_parent_idx";--> statement-breakpoint
DROP INDEX "knowledge_source_business_url_unique";--> statement-breakpoint
DROP INDEX "knowledge_source_assistant_url_unique";--> statement-breakpoint
CREATE INDEX "index_run_organization_idx" ON "index_run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_organization_idx" ON "knowledge_chunk" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "knowledge_correction_organization_status_idx" ON "knowledge_correction" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_shared_block_organization_idx" ON "knowledge_shared_block" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "knowledge_source_organization_parent_idx" ON "knowledge_source" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_source_organization_url_unique" ON "knowledge_source" USING btree ("organization_id","canonical_url");--> statement-breakpoint
ALTER TABLE "assistant" DROP COLUMN "is_lead";--> statement-breakpoint
ALTER TABLE "assistant" DROP COLUMN "tools";--> statement-breakpoint
ALTER TABLE "assistant" DROP COLUMN "setup_completed_at";--> statement-breakpoint
ALTER TABLE "index_run" DROP COLUMN "assistant_id";--> statement-breakpoint
ALTER TABLE "knowledge_chunk" DROP COLUMN "assistant_id";--> statement-breakpoint
ALTER TABLE "knowledge_correction" DROP COLUMN "assistant_id";--> statement-breakpoint
ALTER TABLE "knowledge_shared_block" DROP COLUMN "assistant_id";--> statement-breakpoint
ALTER TABLE "knowledge_source" DROP COLUMN "assistant_id";