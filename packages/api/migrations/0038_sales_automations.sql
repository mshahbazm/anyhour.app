CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_by_member_id" text,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"stage_id" text,
	"event_type" text,
	"event_config" jsonb,
	"schedule" text,
	"schedule_timezone" text,
	"cancel_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by_member_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_step" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_condition" text,
	"on_failure" text DEFAULT 'stop' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "automation_step_automation_position_unique" UNIQUE("automation_id","position")
);
--> statement-breakpoint
CREATE TABLE "lead_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb,
	"run_id" text,
	"step_run_id" text,
	"actor_member_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_automation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"automation_id" text,
	"automation_name" text NOT NULL,
	"triggered_by" text NOT NULL,
	"trigger_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cancel_reason" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "lead_step_run" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"step_id" text,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_condition" text,
	"on_failure" text DEFAULT 'stop' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_after" timestamp,
	"waiting_for" jsonb,
	"outcome" jsonb,
	"condition_passed" boolean,
	"condition_reasoning" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text,
	"assignee_member_id" text,
	"title" text NOT NULL,
	"note" text,
	"due_at" timestamp NOT NULL,
	"done_at" timestamp,
	"source" text NOT NULL,
	"step_run_id" text,
	"created_by_member_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"last_error" text,
	"next_attempt_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ideal_customer_profile" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "intent" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "qualification" jsonb;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_step" ADD CONSTRAINT "automation_step_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_run_id_lead_automation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."lead_automation_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_step_run_id_lead_step_run_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."lead_step_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_actor_member_id_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_automation_run" ADD CONSTRAINT "lead_automation_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_automation_run" ADD CONSTRAINT "lead_automation_run_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_automation_run" ADD CONSTRAINT "lead_automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_step_run" ADD CONSTRAINT "lead_step_run_run_id_lead_automation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."lead_automation_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_step_run" ADD CONSTRAINT "lead_step_run_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_step_run" ADD CONSTRAINT "lead_step_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_step_run" ADD CONSTRAINT "lead_step_run_step_id_automation_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."automation_step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_member_id_member_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_step_run_id_lead_step_run_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."lead_step_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_id_webhook_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_organization_idx" ON "api_key" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_unique" ON "api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "automation_organization_idx" ON "automation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "automation_stage_idx" ON "automation" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "lead_activity_lead_created_idx" ON "lead_activity" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_automation_run_lead_status_idx" ON "lead_automation_run" USING btree ("lead_id","status");--> statement-breakpoint
CREATE INDEX "lead_step_run_lead_status_idx" ON "lead_step_run" USING btree ("lead_id","status");--> statement-breakpoint
CREATE INDEX "lead_step_run_status_run_after_idx" ON "lead_step_run" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_step_run_one_active_per_lead" ON "lead_step_run" USING btree ("lead_id") WHERE "lead_step_run"."status" in ('evaluating', 'running');--> statement-breakpoint
CREATE INDEX "task_organization_due_idx" ON "task" USING btree ("organization_id","due_at");--> statement-breakpoint
CREATE INDEX "task_assignee_done_idx" ON "task" USING btree ("assignee_member_id","done_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_status_next_attempt_idx" ON "webhook_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_idx" ON "webhook_endpoint" USING btree ("organization_id");