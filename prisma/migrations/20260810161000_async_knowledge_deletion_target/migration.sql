DO $$
BEGIN
  CREATE TYPE "KnowledgeDeletionTargetType" AS ENUM (
    'TRANSCRIPT',
    'NOTE',
    'SAVED_MEDIA',
    'LIBRARY_FOLDER',
    'TRANSCRIPT_ENRICHMENT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "deletionTargetType" "KnowledgeDeletionTargetType",
  ADD COLUMN IF NOT EXISTS "deletionTargetId" TEXT,
  ADD COLUMN IF NOT EXISTS "deletionTargetTitle" TEXT;

CREATE INDEX IF NOT EXISTS "Job_userId_deletionTargetType_deletionTargetId_status_idx"
  ON "Job"("userId", "deletionTargetType", "deletionTargetId", status);

ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_deletion_target_shape";
ALTER TABLE "Job"
  ADD CONSTRAINT "Job_deletion_target_shape" CHECK (
    (
      type = 'DELETE_KNOWLEDGE'::"JobType"
      AND "deletionTargetType" IS NOT NULL
      AND "deletionTargetId" IS NOT NULL
      AND "deletionTargetTitle" IS NOT NULL
    )
    OR
    (
      type <> 'DELETE_KNOWLEDGE'::"JobType"
      AND "deletionTargetType" IS NULL
      AND "deletionTargetId" IS NULL
      AND "deletionTargetTitle" IS NULL
    )
  ) NOT VALID;

ALTER TABLE "Job" VALIDATE CONSTRAINT "Job_deletion_target_shape";
