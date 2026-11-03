ALTER TABLE "message" ADD COLUMN "generation_attempt_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "generation_expires_at" timestamp;--> statement-breakpoint
CREATE INDEX "contact_org_created_id_idx" ON "contact" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "conversation_assistant_created_id_idx" ON "conversation" USING btree ("assistant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "submission_form_submitted_id_idx" ON "form_submission" USING btree ("form_id","submitted_at","id");--> statement-breakpoint
CREATE INDEX "lead_org_created_id_idx" ON "lead" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "message_pending_expiry_idx" ON "message" USING btree ("generation_expires_at") WHERE "message"."status" = 'pending';