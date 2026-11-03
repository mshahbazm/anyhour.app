CREATE TABLE "ai_usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assistant_id" text,
	"conversation_id" text,
	"source_id" text,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(16, 10),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"welcome_message" text DEFAULT 'How can I help?' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refresh_interval_hours" integer,
	"next_refresh_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text,
	"email" text,
	"normalized_email" text,
	"phone" text,
	"normalized_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"contact_id" text,
	"resume_token_hash" text NOT NULL,
	"known_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entry_url" text,
	"status" text DEFAULT 'open' NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "form" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_field" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"options" jsonb,
	"prefill_from" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"conversation_id" text,
	"contact_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"field_snapshot" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_run" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"target_source_id" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"indexed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error_summary" text
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"source_id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_source" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"parent_id" text,
	"kind" text NOT NULL,
	"input_url" text,
	"canonical_url" text,
	"object_key" text,
	"file_name" text,
	"mime_type" text,
	"file_size" integer,
	"title" text,
	"include_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclude_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_included" boolean DEFAULT true NOT NULL,
	"discovered_via" text,
	"depth" integer,
	"cleaned_text" text,
	"content_hash" text,
	"cleaned_char_count" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_attempt_status" text,
	"etag" text,
	"last_modified_header" text,
	"last_seen_at" timestamp,
	"last_checked_at" timestamp,
	"last_indexed_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assistant_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'new' NOT NULL,
	"captured_via" text NOT NULL,
	"assigned_member_id" text,
	"merged_into_lead_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "lead_conversation" (
	"lead_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_conversation_lead_id_conversation_id_pk" PRIMARY KEY("lead_id","conversation_id")
);
--> statement-breakpoint
CREATE TABLE "lead_note" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"author_member_id" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"client_message_id" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "public_rate_limit" (
	"key_hash" text NOT NULL,
	"bucket_start" timestamp NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "public_rate_limit_key_hash_bucket_start_pk" PRIMARY KEY("key_hash","bucket_start")
);
--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant" ADD CONSTRAINT "assistant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_field" ADD CONSTRAINT "form_field_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_run" ADD CONSTRAINT "index_run_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_run" ADD CONSTRAINT "index_run_target_source_id_knowledge_source_id_fk" FOREIGN KEY ("target_source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD CONSTRAINT "knowledge_source_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD CONSTRAINT "knowledge_source_parent_id_knowledge_source_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."knowledge_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_member_id_member_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_merged_into_lead_id_lead_id_fk" FOREIGN KEY ("merged_into_lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_conversation" ADD CONSTRAINT "lead_conversation_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_conversation" ADD CONSTRAINT "lead_conversation_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_note" ADD CONSTRAINT "lead_note_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_note" ADD CONSTRAINT "lead_note_author_member_id_member_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_organization_created_idx" ON "ai_usage_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_organization_idx" ON "assistant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contact_org_email_idx" ON "contact" USING btree ("organization_id","normalized_email");--> statement-breakpoint
CREATE INDEX "contact_org_phone_idx" ON "contact" USING btree ("organization_id","normalized_phone");--> statement-breakpoint
CREATE INDEX "conversation_assistant_last_message_idx" ON "conversation" USING btree ("assistant_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_resume_token_hash_unique" ON "conversation" USING btree ("resume_token_hash");--> statement-breakpoint
CREATE INDEX "form_assistant_idx" ON "form" USING btree ("assistant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_one_default_per_assistant" ON "form" USING btree ("assistant_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "form_field_form_position_idx" ON "form_field" USING btree ("form_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "form_field_form_key_unique" ON "form_field" USING btree ("form_id","key");--> statement-breakpoint
CREATE INDEX "form_submission_form_idx" ON "form_submission" USING btree ("form_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_idempotency_unique" ON "form_submission" USING btree ("form_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "index_run_assistant_idx" ON "index_run" USING btree ("assistant_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_assistant_idx" ON "knowledge_chunk" USING btree ("assistant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunk_source_position_unique" ON "knowledge_chunk" USING btree ("source_id","position");--> statement-breakpoint
CREATE INDEX "knowledge_source_assistant_parent_idx" ON "knowledge_source" USING btree ("assistant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_source_assistant_url_unique" ON "knowledge_source" USING btree ("assistant_id","canonical_url");--> statement-breakpoint
CREATE INDEX "lead_organization_created_idx" ON "lead" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_contact_idx" ON "lead" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "lead_note_lead_idx" ON "lead_note" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "message_conversation_created_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_conversation_client_unique" ON "message" USING btree ("conversation_id","client_message_id");