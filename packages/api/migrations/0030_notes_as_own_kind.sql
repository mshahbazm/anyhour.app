-- Notes become their own source kind instead of posing as uploaded Markdown
-- files. Their stored copies are no longer needed: queue them for deletion.
INSERT INTO "storage_cleanup" ("object_key")
SELECT "object_key" FROM "knowledge_source"
WHERE "discovered_via" = 'note' AND "object_key" IS NOT NULL
ON CONFLICT ("object_key") DO NOTHING;
--> statement-breakpoint
UPDATE "knowledge_source"
SET
  "kind" = 'note',
  "title" = regexp_replace(coalesce("title", "file_name", 'Note'), '\.md$', ''),
  "file_name" = NULL,
  "mime_type" = NULL,
  "file_size" = NULL,
  "object_key" = NULL
WHERE "discovered_via" = 'note';
