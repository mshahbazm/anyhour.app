CREATE TABLE "member_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assistant_id" text,
	"kind" text NOT NULL,
	"tag" text,
	"text" text NOT NULL,
	"when" text,
	"steps" jsonb,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_rule" ADD CONSTRAINT "member_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_rule" ADD CONSTRAINT "member_rule_assistant_id_assistant_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_rule_owner_idx" ON "member_rule" USING btree ("organization_id","assistant_id","position");--> statement-breakpoint
-- Every taught behaviour item becomes one of that member's rules, in section order (docs/teamLead.md, round 5).
INSERT INTO "member_rule" ("id", "organization_id", "assistant_id", "kind", "tag", "text", "position") SELECT gen_random_uuid()::text, "a"."organization_id", "a"."id", 'rule', CASE "s"."section" WHEN 'qualify' THEN 'askFirst' WHEN 'handoff' THEN 'handOver' WHEN 'tone' THEN 'tone' WHEN 'avoid' THEN 'never' END, left(btrim("i"."item"), 300), (row_number() OVER (PARTITION BY "a"."id" ORDER BY "s"."ord", "i"."ord") - 1)::int FROM "assistant" "a" CROSS JOIN LATERAL (VALUES ('qualify', 1), ('recommend', 2), ('convert', 3), ('handoff', 4), ('situations', 5), ('tone', 6), ('avoid', 7)) AS "s"("section", "ord") CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof("a"."behaviour" -> "s"."section") = 'array' THEN "a"."behaviour" -> "s"."section" ELSE '[]'::jsonb END) WITH ORDINALITY AS "i"("item", "ord") WHERE btrim("i"."item") <> '' AND NOT EXISTS (SELECT 1 FROM "member_rule" "r" WHERE "r"."assistant_id" = "a"."id");
