DROP INDEX "connection_provider_account_idx";--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "tools" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_website_origin_idx" ON "connection" USING btree ("organization_id","external_account_id") WHERE "connection"."provider" = 'website';--> statement-breakpoint
CREATE UNIQUE INDEX "connection_provider_account_idx" ON "connection" USING btree ("provider","external_account_id") WHERE "connection"."provider" <> 'website';--> statement-breakpoint
-- Every live AI team member's allowed websites become website channels it answers (the oldest member keeps a site two of them shared).
INSERT INTO "connection" ("id", "organization_id", "provider", "status", "external_account_id", "assistant_id", "settings") SELECT gen_random_uuid()::text, "a"."organization_id", 'website', 'active', "o"."origin", "a"."id", '{}'::jsonb FROM "assistant" "a" CROSS JOIN LATERAL jsonb_array_elements_text("a"."allowed_origins") AS "o"("origin") WHERE "a"."status" <> 'archived' ORDER BY "a"."created_at", "a"."id" ON CONFLICT DO NOTHING;
