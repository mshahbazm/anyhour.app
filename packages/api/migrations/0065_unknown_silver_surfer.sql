ALTER TABLE "lead_activity" DROP CONSTRAINT "lead_activity_run_id_lead_automation_run_id_fk";
--> statement-breakpoint
ALTER TABLE "lead_activity" DROP CONSTRAINT "lead_activity_step_run_id_lead_step_run_id_fk";
--> statement-breakpoint
ALTER TABLE "whatsapp_message" DROP CONSTRAINT "whatsapp_message_step_run_id_lead_step_run_id_fk";
--> statement-breakpoint
DROP INDEX "whatsapp_message_agent_step_kind_idx";--> statement-breakpoint
DROP INDEX "whatsapp_message_autopilot_idx";--> statement-breakpoint
ALTER TABLE "lead_activity" DROP COLUMN "run_id";--> statement-breakpoint
ALTER TABLE "lead_activity" DROP COLUMN "step_run_id";--> statement-breakpoint
ALTER TABLE "whatsapp_agent" DROP COLUMN "autopilot";--> statement-breakpoint
ALTER TABLE "whatsapp_agent" DROP COLUMN "autopilot_changed_at";--> statement-breakpoint
ALTER TABLE "whatsapp_message" DROP COLUMN "step_run_id";