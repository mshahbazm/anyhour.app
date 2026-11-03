CREATE TABLE "whatsapp_agent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"token_fingerprint" text NOT NULL,
	"owner_user_id" text,
	"connected_by_member_id" text,
	"poll_offset" text DEFAULT '0' NOT NULL,
	"autopilot" boolean DEFAULT false NOT NULL,
	"autopilot_changed_at" timestamp,
	"status" text DEFAULT 'waiting_for_hi' NOT NULL,
	"linked_at" timestamp,
	"last_polled_at" timestamp,
	"last_error" text,
	"next_send_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"wa_message_id" text,
	"quoted_wa_message_id" text,
	"text" text NOT NULL,
	"step_run_id" text,
	"lead_id" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_agent" ADD CONSTRAINT "whatsapp_agent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_agent" ADD CONSTRAINT "whatsapp_agent_connected_by_member_id_member_id_fk" FOREIGN KEY ("connected_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_step_run_id_lead_step_run_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."lead_step_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_agent_organization_idx" ON "whatsapp_agent" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_agent_token_fingerprint_idx" ON "whatsapp_agent" USING btree ("token_fingerprint");--> statement-breakpoint
CREATE INDEX "whatsapp_message_organization_sent_idx" ON "whatsapp_message" USING btree ("organization_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_message_wa_id_idx" ON "whatsapp_message" USING btree ("organization_id","wa_message_id") WHERE "whatsapp_message"."wa_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_message_step_kind_idx" ON "whatsapp_message" USING btree ("step_run_id","kind") WHERE "whatsapp_message"."step_run_id" is not null;