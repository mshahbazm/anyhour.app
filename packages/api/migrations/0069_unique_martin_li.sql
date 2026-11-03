ALTER TABLE "member_rule" DROP CONSTRAINT "member_rule_assistant_id_assistant_id_fk";
--> statement-breakpoint
DROP INDEX "member_rule_owner_idx";--> statement-breakpoint
CREATE INDEX "member_rule_org_position_idx" ON "member_rule" USING btree ("organization_id","position");--> statement-breakpoint
ALTER TABLE "member_rule" DROP COLUMN "assistant_id";