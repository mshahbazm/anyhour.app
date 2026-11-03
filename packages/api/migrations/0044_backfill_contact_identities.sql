-- Every existing contact email and phone becomes an identity, and every
-- existing lead's contact becomes its requester.
INSERT INTO "contact_identity" ("id", "organization_id", "contact_id", "kind", "value", "normalized_value", "source")
SELECT gen_random_uuid()::text, "organization_id", "id", 'email', coalesce("email", "normalized_email"), "normalized_email", 'backfill'
FROM "contact"
WHERE "normalized_email" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "contact_identity" ("id", "organization_id", "contact_id", "kind", "value", "normalized_value", "source")
SELECT gen_random_uuid()::text, "organization_id", "id", 'phone', coalesce("phone", "normalized_phone"), "normalized_phone", 'backfill'
FROM "contact"
WHERE "normalized_phone" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "lead_contact" ("lead_id", "contact_id", "role", "added_at")
SELECT "id", "contact_id", 'requester', "created_at"
FROM "lead"
ON CONFLICT DO NOTHING;
