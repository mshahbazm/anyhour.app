-- Every workspace starts with the Sales pipeline (a snapshot of the "sales"
-- template), and existing leads move to the stage matching their old status.
INSERT INTO "pipeline" ("id", "organization_id", "name", "template", "is_default")
SELECT gen_random_uuid()::text, "id", 'Sales', 'sales', true
FROM "organization"
WHERE NOT EXISTS (
  SELECT 1 FROM "pipeline" WHERE "pipeline"."organization_id" = "organization"."id"
);
--> statement-breakpoint
INSERT INTO "pipeline_stage" ("id", "pipeline_id", "name", "category", "is_entry", "position")
SELECT gen_random_uuid()::text, "pipeline"."id", stage.name, stage.category, stage.is_entry, stage.position
FROM "pipeline"
CROSS JOIN (VALUES
  ('New', 'open', true, 0),
  ('Contacted', 'open', false, 1),
  ('Qualified', 'open', false, 2),
  ('Won', 'won', false, 3),
  ('Lost', 'lost', false, 4)
) AS stage(name, category, is_entry, position)
WHERE "pipeline"."template" = 'sales'
  AND NOT EXISTS (
    SELECT 1 FROM "pipeline_stage" WHERE "pipeline_stage"."pipeline_id" = "pipeline"."id"
  );
--> statement-breakpoint
UPDATE "lead"
SET "pipeline_id" = "pipeline"."id",
    "stage_id" = "pipeline_stage"."id"
FROM "pipeline"
JOIN "pipeline_stage" ON "pipeline_stage"."pipeline_id" = "pipeline"."id"
WHERE "pipeline"."organization_id" = "lead"."organization_id"
  AND "pipeline"."is_default"
  AND "lead"."stage_id" IS NULL
  AND "pipeline_stage"."name" = CASE "lead"."status"
    WHEN 'new' THEN 'New'
    WHEN 'contacted' THEN 'Contacted'
    WHEN 'qualified' THEN 'Qualified'
    ELSE 'Won'
  END;
