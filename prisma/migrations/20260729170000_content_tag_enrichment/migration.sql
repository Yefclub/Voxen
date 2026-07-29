CREATE TYPE "EnrichmentStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'COMPLETE',
  'RETRY',
  'SKIPPED'
);

ALTER TABLE "Transcript"
  ADD COLUMN "taggingStatus" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "taggingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taggingStartedAt" TIMESTAMP(3),
  ADD COLUMN "taggingNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "taggingError" TEXT;

UPDATE "Transcript" AS t
SET "taggingStatus" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "TranscriptTag" AS tt
    WHERE tt."transcriptId" = t.id
  ) THEN 'COMPLETE'::"EnrichmentStatus"
  ELSE 'PENDING'::"EnrichmentStatus"
END;

CREATE INDEX "Transcript_taggingStatus_taggingNextAttemptAt_idx"
  ON "Transcript"("taggingStatus", "taggingNextAttemptAt");
