CREATE TABLE "ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"conversation_id" text,
	"lead_id" text,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_member_id" text,
	"source" text NOT NULL,
	"solved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor" text NOT NULL,
	"actor_member_id" text,
	"text" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "channel" text DEFAULT 'widget' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "handled_by" text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "assigned_member_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "needs_human_since" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "handoff_summary" jsonb;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "handoff_draft" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "staff_member_id" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assignee_member_id_member_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_actor_member_id_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_org_updated_idx" ON "ticket" USING btree ("organization_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "ticket_org_status_idx" ON "ticket" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ticket_conversation_idx" ON "ticket" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ticket_contact_idx" ON "ticket" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "ticket_lead_idx" ON "ticket" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ticket_activity_ticket_created_idx" ON "ticket_activity" USING btree ("ticket_id","created_at");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assigned_member_id_member_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_staff_member_id_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_needs_human_idx" ON "conversation" USING btree ("assistant_id","needs_human_since");