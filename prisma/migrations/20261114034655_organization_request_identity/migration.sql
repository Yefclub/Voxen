-- CreateTable
CREATE TABLE IF NOT EXISTS "OrganizationRequest" (
    "userId" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationRequest_pkey" PRIMARY KEY ("userId","transcriptId","key")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrganizationRequest_runId_idx" ON "OrganizationRequest"("runId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationRequest_runId_fkey' AND conrelid = '"OrganizationRequest"'::regclass) THEN
    ALTER TABLE "OrganizationRequest" ADD CONSTRAINT "OrganizationRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OrganizationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Preserve the original accepted keys of runs created before the request ledger.
INSERT INTO "OrganizationRequest" ("userId", "transcriptId", key, "runId")
SELECT run."userId", run."transcriptId", run."runKey", run.id
FROM "OrganizationRun" run JOIN "Transcript" source
  ON source.id = run."transcriptId" AND source."userId" = run."userId"
ON CONFLICT ("userId", "transcriptId", key) DO NOTHING;
