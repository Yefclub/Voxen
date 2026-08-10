DO $$ BEGIN
  CREATE TYPE "TranscriptCorrectionState" AS ENUM ('ACTIVE', 'STALE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "TranscriptCorrectionActor" AS ENUM ('USER', 'MCP', 'CHAT', 'RESTORE', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Transcript"
  ADD COLUMN IF NOT EXISTS "correctionRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "correctedMarkdown" TEXT,
  ADD COLUMN IF NOT EXISTS "correctedPlainText" TEXT,
  ADD COLUMN IF NOT EXISTS "correctedChecksum" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionSourceVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "correctionSourceChecksum" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionState" "TranscriptCorrectionState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "correctionStaleReason" TEXT;

CREATE TABLE IF NOT EXISTS "TranscriptCorrectionRevision" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transcriptId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "sourceChecksum" TEXT,
  "markdown" TEXT NOT NULL,
  "plainText" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "actor" "TranscriptCorrectionActor" NOT NULL,
  "operation" JSONB,
  "changeSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptCorrectionRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TranscriptCorrectionRevision_transcriptId_revision_key"
  ON "TranscriptCorrectionRevision"("transcriptId", "revision");
CREATE INDEX IF NOT EXISTS "TranscriptCorrectionRevision_userId_transcriptId_createdAt_idx"
  ON "TranscriptCorrectionRevision"("userId", "transcriptId", "createdAt" DESC);
DO $$ BEGIN
  ALTER TABLE "TranscriptCorrectionRevision" ADD CONSTRAINT "TranscriptCorrectionRevision_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "TranscriptCorrectionRevision" ADD CONSTRAINT "TranscriptCorrectionRevision_transcriptId_fkey"
    FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION update_transcript_search_vector() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector(
    'portuguese',
    CASE WHEN NEW."correctionState" = 'ACTIVE'::"TranscriptCorrectionState"
      THEN coalesce(NEW."correctedPlainText", NEW."plainText", '')
      ELSE coalesce(NEW."plainText", '') END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcript_search_vector_update ON "Transcript";
CREATE TRIGGER transcript_search_vector_update
BEFORE INSERT OR UPDATE OF "plainText", "correctedPlainText", "correctionState" ON "Transcript"
FOR EACH ROW EXECUTE FUNCTION update_transcript_search_vector();
