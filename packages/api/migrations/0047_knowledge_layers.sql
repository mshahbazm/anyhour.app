DROP INDEX "index_run_assistant_idx";--> statement-breakpoint
DROP INDEX "knowledge_chunk_assistant_idx";--> statement-breakpoint
DROP INDEX "knowledge_correction_assistant_status_idx";--> statement-breakpoint
DROP INDEX "knowledge_source_assistant_parent_idx";--> statement-breakpoint
DROP INDEX "knowledge_source_assistant_url_unique";--> statement-breakpoint
ALTER TABLE "index_run" ALTER COLUMN "assistant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ALTER COLUMN "assistant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_correction" ALTER COLUMN "assistant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_shared_block" ALTER COLUMN "assistant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_source" ALTER COLUMN "assistant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_correction" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_shared_block" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "index_run" ADD CONSTRAINT "index_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_correction" ADD CONSTRAINT "knowledge_correction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_shared_block" ADD CONSTRAINT "knowledge_shared_block_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD CONSTRAINT "knowledge_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_run_owner_idx" ON "index_run" USING btree ("organization_id","assistant_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_owner_idx" ON "knowledge_chunk" USING btree ("organization_id","assistant_id");--> statement-breakpoint
CREATE INDEX "knowledge_correction_owner_status_idx" ON "knowledge_correction" USING btree ("organization_id","assistant_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_shared_block_owner_idx" ON "knowledge_shared_block" USING btree ("organization_id","assistant_id");--> statement-breakpoint
CREATE INDEX "knowledge_source_owner_parent_idx" ON "knowledge_source" USING btree ("organization_id","assistant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_source_business_url_unique" ON "knowledge_source" USING btree ("organization_id","canonical_url") WHERE "knowledge_source"."assistant_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_source_assistant_url_unique" ON "knowledge_source" USING btree ("assistant_id","canonical_url") WHERE "knowledge_source"."assistant_id" is not null;