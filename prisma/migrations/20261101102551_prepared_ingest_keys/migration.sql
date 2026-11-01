-- Versioned prepared-content ingestion contract (spec 216, issue #895).
-- Idempotent retries resolve to the original target instead of duplicating
-- documents. Idempotent: uses IF NOT EXISTS so it can be re-run safely.

CREATE TABLE IF NOT EXISTS "PreparedIngestKey" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "producerId" TEXT,
  "externalId" TEXT,
  "contractVersion" TEXT NOT NULL DEFAULT '1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreparedIngestKey_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "PreparedIngestKey" ADD CONSTRAINT "PreparedIngestKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PreparedIngestKey_userId_key_key" ON "PreparedIngestKey"("userId", "key");
CREATE INDEX IF NOT EXISTS "PreparedIngestKey_userId_targetType_targetId_idx" ON "PreparedIngestKey"("userId", "targetType", "targetId");
