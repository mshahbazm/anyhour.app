DROP INDEX "message_pending_expiry_idx";--> statement-breakpoint
DROP INDEX "message_one_pending_reply";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "generation_attempt_id";--> statement-breakpoint
ALTER TABLE "message" DROP COLUMN "generation_expires_at";