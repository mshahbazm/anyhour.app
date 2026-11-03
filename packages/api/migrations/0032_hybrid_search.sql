ALTER TABLE "knowledge_chunk" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "knowledge_chunk"."text")) STORED;--> statement-breakpoint
ALTER TABLE "knowledge_shared_block" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "knowledge_shared_block"."text")) STORED;--> statement-breakpoint
CREATE INDEX "knowledge_chunk_search_idx" ON "knowledge_chunk" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "knowledge_shared_block_search_idx" ON "knowledge_shared_block" USING gin ("search_vector");