CREATE TABLE "connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_account_id" text NOT NULL,
	"assistant_id" text,
	"credentials_encrypted" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_by_member_id" text,
	"last_error" text,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_event" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"external_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "connection_member" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"member_id" text,
	"dm_channel_id" text,
	"link_token_hash" text,
	"link_expires_at" timestamp,
	"linked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_agent" DROP CONSTRAINT "whatsapp_agent_connected_by_member_id_member_id_fk";
--> statement-breakpoint
DROP INDEX "whatsapp_message_step_kind_idx";--> statement-breakpoint
DROP INDEX "whatsapp_agent_organization_idx";--> statement-breakpoint
ALTER TABLE "whatsapp_agent" ADD COLUMN "assistant_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "workspace_chat" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_message" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "workspace_ui_block" ADD COLUMN "pending_action" jsonb;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_connected_by_member_id_member_id_fk" FOREIGN KEY ("connected_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_event" ADD CONSTRAINT "connection_event_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_member" ADD CONSTRAINT "connection_member_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_member" ADD CONSTRAINT "connection_member_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_provider_account_idx" ON "connection" USING btree ("provider","external_account_id");--> statement-breakpoint
CREATE INDEX "connection_organization_idx" ON "connection" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_event_external_idx" ON "connection_event" USING btree ("connection_id","external_event_id");--> statement-breakpoint
CREATE INDEX "connection_event_prune_idx" ON "connection_event" USING btree ("received_at") WHERE "connection_event"."processed_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_member_external_idx" ON "connection_member" USING btree ("connection_id","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_member_token_idx" ON "connection_member" USING btree ("link_token_hash");--> statement-breakpoint
CREATE INDEX "connection_member_member_idx" ON "connection_member" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "whatsapp_agent" ADD CONSTRAINT "whatsapp_agent_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_agent" ADD CONSTRAINT "whatsapp_agent_connected_by_member_id_member_id_fk" FOREIGN KEY ("connected_by_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_agent_id_whatsapp_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."whatsapp_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_agent_member_assistant_idx" ON "whatsapp_agent" USING btree ("connected_by_member_id","assistant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_message_agent_step_kind_idx" ON "whatsapp_message" USING btree ("agent_id","step_run_id","kind") WHERE "whatsapp_message"."step_run_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_message_autopilot_idx" ON "whatsapp_message" USING btree ("step_run_id") WHERE "whatsapp_message"."kind" = 'autopilot';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_chat_shared_idx" ON "workspace_chat" USING btree ("user_id","organization_id","assistant_id") WHERE "workspace_chat"."shared";--> statement-breakpoint
CREATE INDEX "whatsapp_agent_organization_idx" ON "whatsapp_agent" USING btree ("organization_id");