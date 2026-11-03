ALTER TABLE "lead" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "status_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "value" integer;--> statement-breakpoint
CREATE INDEX "lead_organization_status_idx" ON "lead" USING btree ("organization_id","status");