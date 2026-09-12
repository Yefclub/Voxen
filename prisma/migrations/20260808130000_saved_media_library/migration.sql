ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'DOWNLOAD_MEDIA';

DO $$ BEGIN
  CREATE TYPE "SavedMediaStatus" AS ENUM (
    'QUEUED',
    'DOWNLOADING',
    'READY',
    'PROCESSING',
    'PROCESSED',
    'DELETING',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "SavedMediaStatus" ADD VALUE IF NOT EXISTS 'DELETING';

CREATE TABLE IF NOT EXISTS "SavedMedia" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "title" TEXT,
  "channel" TEXT,
  "author" TEXT,
  "durationSec" INTEGER,
  "thumbnailUrl" TEXT,
  "objectKey" TEXT,
  "filename" TEXT,
  "mimeType" TEXT,
  "byteSize" BIGINT,
  "status" "SavedMediaStatus" NOT NULL DEFAULT 'QUEUED',
  "errorMsg" TEXT,
  "transcriptId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "SavedMedia_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "savedMediaId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "SavedMedia_transcriptId_key"
  ON "SavedMedia"("transcriptId");
CREATE UNIQUE INDEX IF NOT EXISTS "SavedMedia_userId_canonicalUrl_key"
  ON "SavedMedia"("userId", "canonicalUrl");
CREATE INDEX IF NOT EXISTS "SavedMedia_userId_createdAt_idx"
  ON "SavedMedia"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SavedMedia_userId_status_createdAt_idx"
  ON "SavedMedia"("userId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Job_userId_savedMediaId_status_idx"
  ON "Job"("userId", "savedMediaId", "status");

DO $$ BEGIN
  ALTER TABLE "SavedMedia"
    ADD CONSTRAINT "SavedMedia_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SavedMedia"
    ADD CONSTRAINT "SavedMedia_transcriptId_fkey"
    FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Job"
    ADD CONSTRAINT "Job_savedMediaId_fkey"
    FOREIGN KEY ("savedMediaId") REFERENCES "SavedMedia"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
