ALTER TYPE "BrainCompilationStatus" ADD VALUE IF NOT EXISTS 'RUNNING';
ALTER TYPE "BrainCompilationStatus" ADD VALUE IF NOT EXISTS 'RETRY';

ALTER TABLE "BrainCompilationSegment"
  ADD COLUMN IF NOT EXISTS "claimedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "BrainCompilationSegment_status_nextAttemptAt_idx"
  ON "BrainCompilationSegment"("status", "nextAttemptAt");

CREATE INDEX IF NOT EXISTS "BrainCompilationSegment_leaseExpiresAt_idx"
  ON "BrainCompilationSegment"("leaseExpiresAt");
