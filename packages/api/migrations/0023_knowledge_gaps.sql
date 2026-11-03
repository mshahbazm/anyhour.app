CREATE TABLE "knowledge_gap" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"question" text NOT NULL,
	"question_key" text NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ask_count" integer DEFAULT 0 NOT NULL,
	"last_asked_at" timestamp,
	"conversation_id" text,
	"checked_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_gap" ADD CONSTRAINT "knowledge_gap_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gap" ADD CONSTRAINT "knowledge_gap_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_gap_question_unique" ON "knowledge_gap" USING btree ("assistant_id","question_key");--> statement-breakpoint
CREATE INDEX "knowledge_gap_assistant_status_idx" ON "knowledge_gap" USING btree ("assistant_id","status");