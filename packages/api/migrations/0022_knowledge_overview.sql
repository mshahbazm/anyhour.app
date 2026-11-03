ALTER TABLE "assistant" ALTER COLUMN "appearance" SET DEFAULT '{"brandColor":null,"launcher":"avatar","launcherIcon":"chat","starterPrompts":[]}'::jsonb;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "knowledge_overview" jsonb;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "overview_fingerprint" text;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "overview_updated_at" timestamp;