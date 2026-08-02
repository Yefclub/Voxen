-- Fontes WEB são atualizadas in-place, mas cada conteúdo aceito mantém um
-- snapshot rastreável. DDL idempotente para instalações já existentes.
DO $$ BEGIN
  CREATE TYPE "SourceRefreshStatus" AS ENUM ('CURRENT', 'CHECKING', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Transcript"
  ADD COLUMN IF NOT EXISTS "sourceChecksum" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sourceCollectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceMetadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "sourceRefreshStatus" "SourceRefreshStatus" NOT NULL DEFAULT 'CURRENT',
  ADD COLUMN IF NOT EXISTS "sourceRefreshError" TEXT;

CREATE INDEX IF NOT EXISTS "Transcript_userId_sourceRefreshStatus_idx"
  ON "Transcript"("userId", "sourceRefreshStatus");

CREATE TABLE IF NOT EXISTS "SourceContentVersion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transcriptId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "mdPath" TEXT NOT NULL,
  "plainText" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceContentVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceContentVersion_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SourceContentVersion_transcriptId_fkey"
    FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SourceContentVersion_transcriptId_version_key"
  ON "SourceContentVersion"("transcriptId", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "SourceContentVersion_transcriptId_checksum_key"
  ON "SourceContentVersion"("transcriptId", "checksum");
CREATE INDEX IF NOT EXISTS "SourceContentVersion_userId_transcriptId_collectedAt_idx"
  ON "SourceContentVersion"("userId", "transcriptId", "collectedAt" DESC);

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "refreshTranscriptId" TEXT;
CREATE INDEX IF NOT EXISTS "Job_userId_refreshTranscriptId_status_idx"
  ON "Job"("userId", "refreshTranscriptId", status);

DO $$ BEGIN
  ALTER TABLE "Job" ADD CONSTRAINT "Job_refreshTranscriptId_fkey"
    FOREIGN KEY ("refreshTranscriptId") REFERENCES "Transcript"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
