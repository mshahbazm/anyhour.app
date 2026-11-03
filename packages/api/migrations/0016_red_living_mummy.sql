CREATE TABLE "workspace_action" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"name" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workspace_chat" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"assistant_id" text,
	"title" text DEFAULT 'Knowledge setup' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_message" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"client_message_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"error_code" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "preview_user_id" text;--> statement-breakpoint
ALTER TABLE "workspace_action" ADD CONSTRAINT "workspace_action_message_id_workspace_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."workspace_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_chat" ADD CONSTRAINT "workspace_chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_chat" ADD CONSTRAINT "workspace_chat_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_chat" ADD CONSTRAINT "workspace_chat_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_message" ADD CONSTRAINT "workspace_message_chat_id_workspace_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."workspace_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_action_message_idx" ON "workspace_action" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "workspace_chat_user_org_idx" ON "workspace_chat" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_message_client_unique" ON "workspace_message" USING btree ("chat_id","client_message_id","role");--> statement-breakpoint
CREATE INDEX "workspace_message_chat_created_idx" ON "workspace_message" USING btree ("chat_id","created_at");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_preview_user_id_user_id_fk" FOREIGN KEY ("preview_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;