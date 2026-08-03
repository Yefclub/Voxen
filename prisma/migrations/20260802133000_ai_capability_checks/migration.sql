CREATE TABLE IF NOT EXISTS "AiCapabilityCheck" (
  "id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "errorMessage" TEXT,
  "latencyMs" INTEGER,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCapabilityCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiCapabilityCheck_capability_success_checkedAt_idx"
  ON "AiCapabilityCheck"("capability", "success", "checkedAt" DESC);
