ALTER TABLE "TranscriptEnrichment" ADD COLUMN IF NOT EXISTS "generationSettings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "TranscriptEnrichment" ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT;
ALTER TABLE "TranscriptEnrichment" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

CREATE OR REPLACE FUNCTION voxen_invalidate_transcript_research() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_changed BOOLEAN;
BEGIN
  source_changed := OLD."userId" IS DISTINCT FROM NEW."userId"
    OR OLD.title IS DISTINCT FROM NEW.title OR OLD."plainText" IS DISTINCT FROM NEW."plainText"
    OR OLD."sourceVersion" IS DISTINCT FROM NEW."sourceVersion" OR OLD."sourceChecksum" IS DISTINCT FROM NEW."sourceChecksum"
    OR OLD."correctionRevision" IS DISTINCT FROM NEW."correctionRevision"
    OR OLD."correctedChecksum" IS DISTINCT FROM NEW."correctedChecksum"
    OR OLD."correctedPlainText" IS DISTINCT FROM NEW."correctedPlainText"
    OR OLD."correctionState" IS DISTINCT FROM NEW."correctionState";
  IF NOT source_changed THEN
    -- Visibility changes fence unfinished work. Accepted context remains valid
    -- if an unchanged source is later restored; reads already require ACTIVE.
    IF NEW.status <> 'ACTIVE' THEN
      UPDATE "TranscriptEnrichment"
      SET "staleReason" = 'parent-inactive', "cancelRequestedAt" = CURRENT_TIMESTAMP,
          status = 'CANCELLED', "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
          revision = revision + 1, "brainProjectionPending" = TRUE,
          "brainProjectionNextAttemptAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "transcriptId" = NEW.id AND "userId" = NEW."userId"
        AND status IN ('PENDING', 'RUNNING', 'RETRY');
    END IF;
    RETURN NEW;
  END IF;
  UPDATE "TranscriptEnrichment"
  SET "staleReason" = CASE WHEN NEW.status <> 'ACTIVE' THEN 'parent-inactive' ELSE 'source-version-changed' END,
      "cancelRequestedAt" = CASE WHEN status IN ('PENDING', 'RUNNING', 'RETRY') THEN CURRENT_TIMESTAMP ELSE "cancelRequestedAt" END,
      status = CASE WHEN status IN ('PENDING', 'RUNNING', 'RETRY') THEN 'CANCELLED'::"TranscriptEnrichmentStatus" ELSE status END,
      "leaseOwner" = NULL,
      "leaseExpiresAt" = NULL,
      revision = revision + 1,
      "brainProjectionPending" = TRUE,
      "brainProjectionNextAttemptAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "transcriptId" = NEW.id AND "userId" IN (OLD."userId", NEW."userId")
    AND ("staleReason" IS NULL OR status IN ('PENDING', 'RUNNING', 'RETRY'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transcript_research_source_changed ON "Transcript";
CREATE TRIGGER transcript_research_source_changed
AFTER UPDATE OF "userId", status, title, "plainText", "sourceVersion", "sourceChecksum", "correctionRevision", "correctedChecksum", "correctedPlainText", "correctionState" ON "Transcript"
FOR EACH ROW
EXECUTE FUNCTION voxen_invalidate_transcript_research();

-- Accepted legacy research was not bound to a correction revision. Keep its
-- content, but require review against the corrected source before retrieval.
UPDATE "TranscriptEnrichment" enrichment
SET "staleReason" = 'correction-version-changed', "brainProjectionPending" = TRUE
FROM "Transcript" transcript
WHERE enrichment."transcriptId" = transcript.id AND enrichment."userId" = transcript."userId"
  AND transcript."correctionRevision" > 0 AND enrichment."staleReason" IS NULL;
