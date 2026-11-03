CREATE TABLE "workspace_ui_block" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_value" text,
	"response_reply_id" text,
	"removal_member_id" text,
	"removal_role" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "main_website_url" text;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "goal_notes" text;--> statement-breakpoint
ALTER TABLE "workspace_ui_block" ADD CONSTRAINT "workspace_ui_block_chat_id_workspace_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."workspace_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ui_block" ADD CONSTRAINT "workspace_ui_block_message_id_workspace_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."workspace_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_ui_block_chat_idx" ON "workspace_ui_block" USING btree ("chat_id");