ALTER TABLE "message" ADD COLUMN "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "block_reply" jsonb;