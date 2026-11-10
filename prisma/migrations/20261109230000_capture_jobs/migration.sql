-- Spec 220: link capture jobs run in the web process with durable leases.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CAPTURE_LINK';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CAPTURE_UPLOAD';

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "captureErrorCode" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "captureCostUsd" DECIMAL(10,6);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "captureMeta" JSONB NOT NULL DEFAULT '{}';
-- Earliest time a queued capture may be claimed again (retry backoff).
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "notBefore" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Job_type_status_notBefore_idx" ON "Job"("type", "status", "notBefore");
