ALTER TABLE "conversation" ADD COLUMN "handed_off_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "note_offer" jsonb;