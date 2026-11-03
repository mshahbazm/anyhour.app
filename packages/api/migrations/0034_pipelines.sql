CREATE TABLE "pipeline" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"is_entry" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stage_id_pipeline_unique" UNIQUE("id","pipeline_id")
);
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "pipeline_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "stage_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "stage_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_organization_idx" ON "pipeline" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_one_default_per_organization" ON "pipeline" USING btree ("organization_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "pipeline_stage_pipeline_position_idx" ON "pipeline_stage" USING btree ("pipeline_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stage_one_entry" ON "pipeline_stage" USING btree ("pipeline_id") WHERE is_entry;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_stage_in_pipeline_fk" FOREIGN KEY ("stage_id","pipeline_id") REFERENCES "public"."pipeline_stage"("id","pipeline_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_stage_idx" ON "lead" USING btree ("stage_id");