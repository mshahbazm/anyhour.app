-- WhatsApp is a channel, not a job to help with: it no longer appears in
-- "What do you want help with?". Drop it from saved answers.
UPDATE "organization" SET "wants_help_with" = "wants_help_with" - 'whatsapp' WHERE "wants_help_with" ? 'whatsapp';
