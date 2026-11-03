DROP TABLE "form" CASCADE;--> statement-breakpoint
DROP TABLE "form_field" CASCADE;--> statement-breakpoint
DROP TABLE "form_submission" CASCADE;--> statement-breakpoint
DROP TABLE "site_stat_daily" CASCADE;--> statement-breakpoint
DROP TABLE "site_visitor_daily" CASCADE;--> statement-breakpoint
DROP TABLE "webhook_delivery" CASCADE;--> statement-breakpoint
DROP TABLE "webhook_endpoint" CASCADE;--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "business_type";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "business_description";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "wants_help_with";--> statement-breakpoint
ALTER TABLE "assistant" DROP COLUMN "tracking";