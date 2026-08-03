ALTER TABLE "Job"
ADD COLUMN IF NOT EXISTS "workerId" TEXT,
ADD COLUMN IF NOT EXISTS "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

-- RUNNINGs anteriores à migration não possuem dono; expiram imediatamente e
-- entram no mesmo recovery das novas tentativas.
UPDATE "Job"
SET "leaseExpiresAt" = NOW()
WHERE status = 'RUNNING';

CREATE INDEX IF NOT EXISTS "Job_status_leaseExpiresAt_idx"
ON "Job"("status", "leaseExpiresAt");

ALTER TABLE "Transcript"
ADD COLUMN IF NOT EXISTS "summaryStatus" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "summaryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "summaryStartedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "summaryNextAttemptAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "summaryError" TEXT;

UPDATE "Transcript"
SET "summaryStatus" = 'COMPLETE'::"EnrichmentStatus"
WHERE "summaryMd" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Transcript_summaryStatus_summaryNextAttemptAt_idx"
ON "Transcript"("summaryStatus", "summaryNextAttemptAt");
