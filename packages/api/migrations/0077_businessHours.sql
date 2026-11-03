ALTER TABLE "organization" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "business_hours" jsonb;