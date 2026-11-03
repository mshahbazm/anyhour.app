ALTER TABLE "conversation" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "external_user_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_connection_user_unique" ON "conversation" USING btree ("connection_id","external_user_id") WHERE "conversation"."connection_id" is not null;--> statement-breakpoint
CREATE INDEX "message_external_idx" ON "message" USING btree ("external_id") WHERE "message"."external_id" is not null;