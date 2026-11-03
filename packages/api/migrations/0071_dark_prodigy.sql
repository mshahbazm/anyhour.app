ALTER TABLE "lead" DROP CONSTRAINT "lead_pipeline_id_pipeline_id_fk";
--> statement-breakpoint
ALTER TABLE "lead" DROP CONSTRAINT "lead_stage_in_pipeline_fk";
--> statement-breakpoint
DROP INDEX "lead_stage_idx";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "pipeline_id";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "stage_id";--> statement-breakpoint
ALTER TABLE "lead" DROP COLUMN "stage_changed_at";