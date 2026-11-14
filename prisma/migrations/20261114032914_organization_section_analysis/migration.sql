-- Preserve the validated result before graph projection so retries do not repeat paid calls.
ALTER TABLE "OrganizationSection" ADD COLUMN IF NOT EXISTS "analysis" JSONB;
