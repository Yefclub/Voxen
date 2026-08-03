ALTER TABLE "Job"
ADD COLUMN "workerId" TEXT,
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

-- RUNNINGs anteriores à migration não possuem dono; expiram imediatamente e
-- entram no mesmo recovery das novas tentativas.
UPDATE "Job"
SET "leaseExpiresAt" = NOW()
WHERE status = 'RUNNING';

CREATE INDEX "Job_status_leaseExpiresAt_idx"
ON "Job"("status", "leaseExpiresAt");

ALTER TABLE "Transcript"
ADD COLUMN "summaryStatus" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "summaryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "summaryStartedAt" TIMESTAMP(3),
ADD COLUMN "summaryNextAttemptAt" TIMESTAMP(3),
ADD COLUMN "summaryError" TEXT;

UPDATE "Transcript"
SET "summaryStatus" = 'COMPLETE'::"EnrichmentStatus"
WHERE "summaryMd" IS NOT NULL;

CREATE INDEX "Transcript_summaryStatus_summaryNextAttemptAt_idx"
ON "Transcript"("summaryStatus", "summaryNextAttemptAt");
