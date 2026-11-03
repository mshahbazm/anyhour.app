DROP INDEX "contact_org_email_idx";--> statement-breakpoint
DROP INDEX "contact_org_phone_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "contact_org_email_unique" ON "contact" USING btree ("organization_id","normalized_email") WHERE "contact"."normalized_email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_org_phone_unique" ON "contact" USING btree ("organization_id","normalized_phone") WHERE "contact"."normalized_phone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "message_one_pending_reply" ON "message" USING btree ("conversation_id") WHERE "message"."role" = 'assistant' and "message"."status" = 'pending';