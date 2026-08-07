ALTER TYPE "BrainSourceType" ADD VALUE IF NOT EXISTS 'EXTERNAL_ENRICHMENT';

CREATE TYPE "TranscriptEnrichmentType" AS ENUM ('WEB_RESEARCH');
CREATE TYPE "TranscriptEnrichmentStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'NO_RESEARCH_NEEDED',
    'READY',
    'RETRY',
    'FAILED',
    'CANCELLED'
);
CREATE TYPE "TranscriptEnrichmentReviewState" AS ENUM ('SUGGESTED', 'ACCEPTED', 'DISMISSED');
CREATE TYPE "TranscriptEnrichmentTrigger" AS ENUM ('AUTO', 'MANUAL', 'MCP');

CREATE TABLE "TranscriptEnrichment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "configRevisionId" TEXT,
    "runKey" TEXT NOT NULL,
    "type" "TranscriptEnrichmentType" NOT NULL DEFAULT 'WEB_RESEARCH',
    "status" "TranscriptEnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewState" "TranscriptEnrichmentReviewState" NOT NULL DEFAULT 'SUGGESTED',
    "trigger" "TranscriptEnrichmentTrigger" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "citations" JSONB NOT NULL DEFAULT '[]',
    "queries" JSONB NOT NULL DEFAULT '[]',
    "rationale" TEXT,
    "noResearchReason" TEXT,
    "sourceVersion" INTEGER NOT NULL DEFAULT 0,
    "sourceChecksum" TEXT,
    "model" TEXT,
    "costUsd" DECIMAL(10,6),
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "searchCallCount" INTEGER NOT NULL DEFAULT 0,
    "searchResultCount" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "staleReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptEnrichment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TranscriptEnrichment_userId_transcriptId_runKey_key"
    ON "TranscriptEnrichment"("userId", "transcriptId", "runKey");
CREATE INDEX "TranscriptEnrichment_userId_transcriptId_createdAt_idx"
    ON "TranscriptEnrichment"("userId", "transcriptId", "createdAt" DESC);
CREATE INDEX "TranscriptEnrichment_status_nextAttemptAt_createdAt_idx"
    ON "TranscriptEnrichment"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "TranscriptEnrichment_userId_reviewState_updatedAt_idx"
    ON "TranscriptEnrichment"("userId", "reviewState", "updatedAt" DESC);
CREATE INDEX "TranscriptEnrichment_configRevisionId_idx"
    ON "TranscriptEnrichment"("configRevisionId");

ALTER TABLE "TranscriptEnrichment"
    ADD CONSTRAINT "TranscriptEnrichment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranscriptEnrichment"
    ADD CONSTRAINT "TranscriptEnrichment_transcriptId_fkey"
    FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranscriptEnrichment"
    ADD CONSTRAINT "TranscriptEnrichment_configRevisionId_fkey"
    FOREIGN KEY ("configRevisionId") REFERENCES "ConfigRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
