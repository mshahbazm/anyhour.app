DROP TABLE "social_asset" CASCADE;--> statement-breakpoint
DROP TABLE "social_post" CASCADE;--> statement-breakpoint
ALTER TABLE "assistant" DROP COLUMN "social_settings";--> statement-breakpoint
ALTER TABLE "conversation" DROP COLUMN "summary";