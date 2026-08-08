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

ALTER TYPE "SavedMediaStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "SavedMediaStatus" ADD VALUE IF NOT EXISTS 'DOWNLOADING';
ALTER TYPE "SavedMediaStatus" ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE "SavedMediaStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "SavedMediaStatus" ADD VALUE IF NOT EXISTS 'PROCESSED';
ALTER TYPE "SavedMediaStatus" ADD VALUE IF NOT EXISTS 'DELETING';
ALTER TYPE "SavedMediaStatus" ADD VALUE IF NOT EXISTS 'FAILED';

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

ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "canonicalUrl" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "author" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "durationSec" INTEGER;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "objectKey" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "filename" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "byteSize" BIGINT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "status" "SavedMediaStatus" DEFAULT 'QUEUED';
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "errorMsg" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "transcriptId" TEXT;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3);
ALTER TABLE "SavedMedia" ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "savedMediaId" TEXT;

ALTER TABLE "SavedMedia" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "sourceUrl" SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "canonicalUrl" SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
ALTER TABLE "SavedMedia" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SavedMedia" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "SavedMedia" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SavedMedia" ALTER COLUMN "updatedAt" SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SavedMedia_pkey'
      AND conrelid = '"SavedMedia"'::regclass
  ) THEN
    ALTER TABLE "SavedMedia" ADD CONSTRAINT "SavedMedia_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

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
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SavedMedia_userId_fkey'
      AND conrelid = '"SavedMedia"'::regclass
  ) THEN
    ALTER TABLE "SavedMedia"
      ADD CONSTRAINT "SavedMedia_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SavedMedia_transcriptId_fkey'
      AND conrelid = '"SavedMedia"'::regclass
  ) THEN
    ALTER TABLE "SavedMedia"
      ADD CONSTRAINT "SavedMedia_transcriptId_fkey"
      FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Job_savedMediaId_fkey'
      AND conrelid = '"Job"'::regclass
  ) THEN
    ALTER TABLE "Job"
      ADD CONSTRAINT "Job_savedMediaId_fkey"
      FOREIGN KEY ("savedMediaId") REFERENCES "SavedMedia"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  expected_columns TEXT[] := ARRAY[
    'id', 'userId', 'sourceUrl', 'canonicalUrl', 'title', 'channel', 'author',
    'durationSec', 'thumbnailUrl', 'objectKey', 'filename', 'mimeType', 'byteSize',
    'status', 'errorMsg', 'transcriptId', 'createdAt', 'updatedAt', 'readyAt',
    'processedAt'
  ];
  missing_columns TEXT[];
BEGIN
  SELECT ARRAY_AGG(column_name ORDER BY column_name)
    INTO missing_columns
  FROM UNNEST(expected_columns) AS expected(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns actual
    WHERE actual.table_schema = current_schema()
      AND actual.table_name = 'SavedMedia'
      AND actual.column_name = expected.column_name
  );

  IF COALESCE(cardinality(missing_columns), 0) > 0 THEN
    RAISE EXCEPTION 'SavedMedia repair is incomplete; missing columns: %', missing_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Job'
      AND column_name = 'savedMediaId'
  ) THEN
    RAISE EXCEPTION 'SavedMedia repair is incomplete; Job.savedMediaId is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum value
    JOIN pg_type type ON type.oid = value.enumtypid
    WHERE type.typname = 'JobType'
      AND value.enumlabel = 'DOWNLOAD_MEDIA'
  ) THEN
    RAISE EXCEPTION 'SavedMedia repair is incomplete; DOWNLOAD_MEDIA job type is missing';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_enum value
    JOIN pg_type type ON type.oid = value.enumtypid
    WHERE type.typname = 'SavedMediaStatus'
      AND value.enumlabel = ANY(ARRAY[
        'QUEUED', 'DOWNLOADING', 'READY', 'PROCESSING', 'PROCESSED', 'DELETING', 'FAILED'
      ])
  ) <> 7 THEN
    RAISE EXCEPTION 'SavedMedia repair is incomplete; enum values are missing';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE (conname = 'SavedMedia_pkey' AND conrelid = '"SavedMedia"'::regclass)
       OR (conname = 'SavedMedia_userId_fkey' AND conrelid = '"SavedMedia"'::regclass)
       OR (conname = 'SavedMedia_transcriptId_fkey' AND conrelid = '"SavedMedia"'::regclass)
       OR (conname = 'Job_savedMediaId_fkey' AND conrelid = '"Job"'::regclass)
  ) <> 4 THEN
    RAISE EXCEPTION 'SavedMedia repair is incomplete; constraints are missing';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = ANY(ARRAY[
        'SavedMedia_transcriptId_key',
        'SavedMedia_userId_canonicalUrl_key',
        'SavedMedia_userId_createdAt_idx',
        'SavedMedia_userId_status_createdAt_idx',
        'Job_userId_savedMediaId_status_idx'
      ])
  ) <> 5 THEN
    RAISE EXCEPTION 'SavedMedia repair is incomplete; indexes are missing';
  END IF;
END $$;
