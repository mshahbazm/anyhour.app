-- Knowledge belongs to the workspace now. Everything a front desk learned
-- becomes "Your business", which every employee reads. A workspace has one
-- front desk today; where test data has several, only the oldest live one
-- with knowledge moves, and the others keep theirs as their own sources so
-- nothing mixes.
UPDATE "knowledge_source" s SET "organization_id" = a."organization_id"
FROM "assistant" a WHERE a."id" = s."assistant_id";
--> statement-breakpoint
UPDATE "knowledge_chunk" c SET "organization_id" = a."organization_id"
FROM "assistant" a WHERE a."id" = c."assistant_id";
--> statement-breakpoint
UPDATE "knowledge_shared_block" b SET "organization_id" = a."organization_id"
FROM "assistant" a WHERE a."id" = b."assistant_id";
--> statement-breakpoint
UPDATE "knowledge_correction" k SET "organization_id" = a."organization_id"
FROM "assistant" a WHERE a."id" = k."assistant_id";
--> statement-breakpoint
UPDATE "index_run" r SET "organization_id" = a."organization_id"
FROM "assistant" a WHERE a."id" = r."assistant_id";
--> statement-breakpoint
-- Children first: the chosen front desk is found by the sources it still owns.
UPDATE "knowledge_chunk" SET "assistant_id" = NULL WHERE "assistant_id" IN (
  SELECT DISTINCT ON (a."organization_id") a."id" FROM "assistant" a
  WHERE EXISTS (SELECT 1 FROM "knowledge_source" s WHERE s."assistant_id" = a."id")
  ORDER BY a."organization_id", (a."status" = 'archived'), a."created_at", a."id"
);
--> statement-breakpoint
UPDATE "knowledge_shared_block" SET "assistant_id" = NULL WHERE "assistant_id" IN (
  SELECT DISTINCT ON (a."organization_id") a."id" FROM "assistant" a
  WHERE EXISTS (SELECT 1 FROM "knowledge_source" s WHERE s."assistant_id" = a."id")
  ORDER BY a."organization_id", (a."status" = 'archived'), a."created_at", a."id"
);
--> statement-breakpoint
UPDATE "knowledge_correction" SET "assistant_id" = NULL WHERE "assistant_id" IN (
  SELECT DISTINCT ON (a."organization_id") a."id" FROM "assistant" a
  WHERE EXISTS (SELECT 1 FROM "knowledge_source" s WHERE s."assistant_id" = a."id")
  ORDER BY a."organization_id", (a."status" = 'archived'), a."created_at", a."id"
);
--> statement-breakpoint
UPDATE "index_run" SET "assistant_id" = NULL WHERE "assistant_id" IN (
  SELECT DISTINCT ON (a."organization_id") a."id" FROM "assistant" a
  WHERE EXISTS (SELECT 1 FROM "knowledge_source" s WHERE s."assistant_id" = a."id")
  ORDER BY a."organization_id", (a."status" = 'archived'), a."created_at", a."id"
);
--> statement-breakpoint
UPDATE "knowledge_source" SET "assistant_id" = NULL WHERE "assistant_id" IN (
  SELECT DISTINCT ON (a."organization_id") a."id" FROM "assistant" a
  WHERE EXISTS (SELECT 1 FROM "knowledge_source" s WHERE s."assistant_id" = a."id")
  ORDER BY a."organization_id", (a."status" = 'archived'), a."created_at", a."id"
);
