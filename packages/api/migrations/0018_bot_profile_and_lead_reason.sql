ALTER TABLE "organization" ADD COLUMN "business_about" text;--> statement-breakpoint
ALTER TABLE "assistant" ADD COLUMN "picture_key" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "reason" text DEFAULT 'enquiry' NOT NULL;