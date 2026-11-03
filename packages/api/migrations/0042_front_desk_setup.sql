ALTER TABLE "assistant" ADD COLUMN "setup_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "setup_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_setup_key_unique" ON "automation" USING btree ("organization_id","setup_key") WHERE "automation"."setup_key" is not null;--> statement-breakpoint
-- Front desks already in use (they have knowledge or went live) skip the new
-- setup wizard.
UPDATE "assistant" SET "setup_completed_at" = now()
WHERE "setup_completed_at" IS NULL
  AND (
    "status" = 'published'
    OR EXISTS (
      SELECT 1 FROM "knowledge_source"
      WHERE "knowledge_source"."assistant_id" = "assistant"."id"
    )
  );
