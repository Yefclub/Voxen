-- CreateEnum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrganizationRunStatus') THEN
        CREATE TYPE "OrganizationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED');
    END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrganizationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "trigger" "TranscriptEnrichmentTrigger" NOT NULL,
    "status" "OrganizationRunStatus" NOT NULL DEFAULT 'PENDING',
    "generationSettings" JSONB NOT NULL DEFAULT '{}',
    "totalSections" INTEGER NOT NULL DEFAULT 0,
    "completedSections" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6),
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "lastError" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrganizationSection" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "status" "OrganizationRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "callPending" BOOLEAN NOT NULL DEFAULT false,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "relationshipCount" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganizationRun_userId_transcriptId_createdAt_idx" ON "OrganizationRun"("userId", "transcriptId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganizationRun_status_nextAttemptAt_createdAt_idx" ON "OrganizationRun"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganizationRun_status_leaseExpiresAt_idx" ON "OrganizationRun"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationRun_userId_transcriptId_runKey_key" ON "OrganizationRun"("userId", "transcriptId", "runKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationSection_runId_sectionKey_key" ON "OrganizationSection"("runId", "sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationSection_runId_ordinal_key" ON "OrganizationSection"("runId", "ordinal");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationRun_userId_fkey' AND conrelid = '"OrganizationRun"'::regclass) THEN
        ALTER TABLE "OrganizationRun" ADD CONSTRAINT "OrganizationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationRun_transcriptId_fkey' AND conrelid = '"OrganizationRun"'::regclass) THEN
        ALTER TABLE "OrganizationRun" ADD CONSTRAINT "OrganizationRun_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationSection_runId_fkey' AND conrelid = '"OrganizationSection"'::regclass) THEN
        ALTER TABLE "OrganizationSection" ADD CONSTRAINT "OrganizationSection_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OrganizationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
