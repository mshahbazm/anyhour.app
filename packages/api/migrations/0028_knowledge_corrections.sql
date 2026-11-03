CREATE TABLE "knowledge_correction" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"note_id" text NOT NULL,
	"source_id" text NOT NULL,
	"excerpt" text NOT NULL,
	"source_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"website_now" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_correction" ADD CONSTRAINT "knowledge_correction_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_correction" ADD CONSTRAINT "knowledge_correction_note_id_knowledge_source_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_correction" ADD CONSTRAINT "knowledge_correction_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_correction_note_source_unique" ON "knowledge_correction" USING btree ("note_id","source_id");--> statement-breakpoint
CREATE INDEX "knowledge_correction_assistant_status_idx" ON "knowledge_correction" USING btree ("assistant_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_correction_source_idx" ON "knowledge_correction" USING btree ("source_id");