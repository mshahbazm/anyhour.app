ALTER TABLE "organization" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "business_description" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "wants_help_with" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "role" text DEFAULT 'frontDesk' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "social_settings" jsonb;