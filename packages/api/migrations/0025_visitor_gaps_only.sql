DELETE FROM "knowledge_gap" WHERE "origin" = 'predicted';--> statement-breakpoint
ALTER TABLE "knowledge_gap" DROP COLUMN "origin";