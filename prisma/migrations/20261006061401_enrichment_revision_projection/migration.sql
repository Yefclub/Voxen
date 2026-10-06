ALTER TABLE "TranscriptEnrichment"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "brainProjectedRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "brainProjectionPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "brainProjectionAttempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "brainProjectionNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "brainProjectionErrorCode" TEXT,
  ADD COLUMN "brainProjectedAt" TIMESTAMP(3);

-- Reconcile previously accepted projections without changing canonical state or timestamps.
UPDATE "TranscriptEnrichment" SET "brainProjectionPending" = true
WHERE "reviewState" = 'ACCEPTED';

CREATE INDEX "TranscriptEnrichment_projection_due_idx"
  ON "TranscriptEnrichment" ("brainProjectionPending", "brainProjectionNextAttemptAt", "updatedAt");
