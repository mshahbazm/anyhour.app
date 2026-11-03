ALTER TABLE "lead" ALTER COLUMN "pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ALTER COLUMN "stage_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "status";