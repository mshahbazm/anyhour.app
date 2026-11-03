ALTER TABLE "contact" DROP CONSTRAINT "contact_company_id_company_id_fk";
--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT "lead_service_id_service_id_fk";
--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT "lead_offer_id_offer_id_fk";
--> statement-breakpoint
DROP INDEX "contact_company_idx";--> statement-breakpoint
DROP INDEX "lead_service_idx";--> statement-breakpoint
DROP INDEX "lead_offer_idx";--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "service_id";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "offer_id";