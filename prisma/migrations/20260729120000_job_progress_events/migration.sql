ALTER TABLE "Job"
  ADD COLUMN "progressStage" TEXT,
  ADD COLUMN "progressPercent" INTEGER,
  ADD COLUMN "progressedAt" TIMESTAMP(3);

CREATE TABLE "JobProgressEvent" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "percent" INTEGER,
  "chunkIndex" INTEGER,
  "transcriptId" TEXT,
  "errorMsg" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobProgressEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Job_userId_progressedAt_idx" ON "Job"("userId", "progressedAt" DESC);
CREATE INDEX "JobProgressEvent_jobId_createdAt_idx" ON "JobProgressEvent"("jobId", "createdAt");
CREATE INDEX "JobProgressEvent_userId_createdAt_idx" ON "JobProgressEvent"("userId", "createdAt");

ALTER TABLE "JobProgressEvent"
  ADD CONSTRAINT "JobProgressEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
