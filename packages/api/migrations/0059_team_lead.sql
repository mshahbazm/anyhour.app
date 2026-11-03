ALTER TABLE "assistant" ADD COLUMN "is_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "job" text;--> statement-breakpoint
-- Every workspace's oldest live AI team member becomes its lead.
UPDATE "assistant" SET "is_lead" = true WHERE "id" IN (SELECT DISTINCT ON ("organization_id") "id" FROM "assistant" WHERE "status" <> 'archived' ORDER BY "organization_id", "created_at", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_lead_idx" ON "assistant" USING btree ("organization_id") WHERE "assistant"."is_lead" and "assistant"."status" <> 'archived';
