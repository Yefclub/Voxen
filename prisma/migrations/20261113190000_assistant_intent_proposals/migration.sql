ALTER TABLE "AssistantRun" ADD COLUMN IF NOT EXISTS "intent" JSONB;
ALTER TABLE "AssistantRun" ADD COLUMN IF NOT EXISTS "approvedProposalId" TEXT;
CREATE TABLE IF NOT EXISTS "AssistantProposal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "runId" TEXT NOT NULL REFERENCES "AssistantRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantProposal_userId_runId_fingerprint_key"
ON "AssistantProposal"("userId", "runId", "fingerprint");
