CREATE TABLE "knowledge_shared_block" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"website_id" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_shared_block_source" (
	"block_id" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "knowledge_shared_block_source_block_id_source_id_pk" PRIMARY KEY("block_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "cleanup_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "index_run" ADD COLUMN "cleanup_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "page_profile" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "page_actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "cleanup_status" text;--> statement-breakpoint
ALTER TABLE "knowledge_shared_block" ADD CONSTRAINT "knowledge_shared_block_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_shared_block" ADD CONSTRAINT "knowledge_shared_block_website_id_knowledge_source_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_shared_block_source" ADD CONSTRAINT "knowledge_shared_block_source_block_id_knowledge_shared_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."knowledge_shared_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_shared_block_source" ADD CONSTRAINT "knowledge_shared_block_source_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_shared_block_website_idx" ON "knowledge_shared_block" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "knowledge_shared_block_source_source_idx" ON "knowledge_shared_block_source" USING btree ("source_id");