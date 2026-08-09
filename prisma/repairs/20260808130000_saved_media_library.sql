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
  invalid_columns TEXT[];
  invalid_constraints TEXT[];
  invalid_indexes TEXT[];
BEGIN
  WITH expected(
    column_name,
    udt_name,
    is_nullable,
    column_default,
    datetime_precision
  ) AS (
    VALUES
      ('id', 'text', 'NO', NULL::TEXT, NULL::INTEGER),
      ('userId', 'text', 'NO', NULL, NULL),
      ('sourceUrl', 'text', 'NO', NULL, NULL),
      ('canonicalUrl', 'text', 'NO', NULL, NULL),
      ('title', 'text', 'YES', NULL, NULL),
      ('channel', 'text', 'YES', NULL, NULL),
      ('author', 'text', 'YES', NULL, NULL),
      ('durationSec', 'int4', 'YES', NULL, NULL),
      ('thumbnailUrl', 'text', 'YES', NULL, NULL),
      ('objectKey', 'text', 'YES', NULL, NULL),
      ('filename', 'text', 'YES', NULL, NULL),
      ('mimeType', 'text', 'YES', NULL, NULL),
      ('byteSize', 'int8', 'YES', NULL, NULL),
      ('status', 'SavedMediaStatus', 'NO', '''QUEUED''::"SavedMediaStatus"', NULL),
      ('errorMsg', 'text', 'YES', NULL, NULL),
      ('transcriptId', 'text', 'YES', NULL, NULL),
      ('createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', 3),
      ('updatedAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', 3),
      ('readyAt', 'timestamp', 'YES', NULL, 3),
      ('processedAt', 'timestamp', 'YES', NULL, 3)
  )
  SELECT ARRAY_AGG(expected.column_name ORDER BY expected.column_name)
    INTO invalid_columns
  FROM expected
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = current_schema()
   AND actual.table_name = 'SavedMedia'
   AND actual.column_name = expected.column_name
  WHERE actual.column_name IS NULL
     OR actual.udt_name IS DISTINCT FROM expected.udt_name
     OR actual.is_nullable IS DISTINCT FROM expected.is_nullable
     OR actual.column_default IS DISTINCT FROM expected.column_default
     OR actual.datetime_precision IS DISTINCT FROM expected.datetime_precision;

  IF COALESCE(cardinality(invalid_columns), 0) > 0 THEN
    RAISE EXCEPTION
      'SavedMedia repair found missing or incompatible columns: %',
      invalid_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns actual
    WHERE actual.table_schema = current_schema()
      AND actual.table_name = 'Job'
      AND actual.column_name = 'savedMediaId'
      AND actual.udt_name = 'text'
      AND actual.is_nullable = 'YES'
      AND actual.column_default IS NULL
  ) THEN
    RAISE EXCEPTION
      'SavedMedia repair found a missing or incompatible Job.savedMediaId column';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum value
    JOIN pg_type type ON type.oid = value.enumtypid
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE type.typname = 'JobType'
      AND namespace.nspname = current_schema()
      AND value.enumlabel = 'DOWNLOAD_MEDIA'
  ) THEN
    RAISE EXCEPTION 'SavedMedia repair is incomplete; DOWNLOAD_MEDIA job type is missing';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_enum value
    JOIN pg_type type ON type.oid = value.enumtypid
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE type.typname = 'SavedMediaStatus'
      AND namespace.nspname = current_schema()
      AND value.enumlabel = ANY(ARRAY[
        'QUEUED', 'DOWNLOADING', 'READY', 'PROCESSING', 'PROCESSED', 'DELETING', 'FAILED'
      ])
  ) <> 7 THEN
    RAISE EXCEPTION 'SavedMedia repair is incomplete; enum values are missing';
  END IF;

  WITH expected(constraint_name, relation, definition) AS (
    VALUES
      (
        'SavedMedia_pkey',
        '"SavedMedia"'::regclass,
        'PRIMARY KEY (id)'
      ),
      (
        'SavedMedia_userId_fkey',
        '"SavedMedia"'::regclass,
        'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE'
      ),
      (
        'SavedMedia_transcriptId_fkey',
        '"SavedMedia"'::regclass,
        'FOREIGN KEY ("transcriptId") REFERENCES "Transcript"(id) ON UPDATE CASCADE ON DELETE SET NULL'
      ),
      (
        'Job_savedMediaId_fkey',
        '"Job"'::regclass,
        'FOREIGN KEY ("savedMediaId") REFERENCES "SavedMedia"(id) ON UPDATE CASCADE ON DELETE SET NULL'
      )
  )
  SELECT ARRAY_AGG(expected.constraint_name ORDER BY expected.constraint_name)
    INTO invalid_constraints
  FROM expected
  LEFT JOIN pg_constraint actual
    ON actual.conname = expected.constraint_name
   AND actual.conrelid = expected.relation
  WHERE actual.oid IS NULL
     OR pg_get_constraintdef(actual.oid) IS DISTINCT FROM expected.definition;

  IF COALESCE(cardinality(invalid_constraints), 0) > 0 THEN
    RAISE EXCEPTION
      'SavedMedia repair found missing or incompatible constraints: %',
      invalid_constraints;
  END IF;

  WITH expected(index_name, relation, definition) AS (
    VALUES
      (
        'SavedMedia_transcriptId_key',
        '"SavedMedia"'::regclass,
        format(
          'CREATE UNIQUE INDEX "SavedMedia_transcriptId_key" ON %I."SavedMedia" USING btree ("transcriptId")',
          current_schema()
        )
      ),
      (
        'SavedMedia_userId_canonicalUrl_key',
        '"SavedMedia"'::regclass,
        format(
          'CREATE UNIQUE INDEX "SavedMedia_userId_canonicalUrl_key" ON %I."SavedMedia" USING btree ("userId", "canonicalUrl")',
          current_schema()
        )
      ),
      (
        'SavedMedia_userId_createdAt_idx',
        '"SavedMedia"'::regclass,
        format(
          'CREATE INDEX "SavedMedia_userId_createdAt_idx" ON %I."SavedMedia" USING btree ("userId", "createdAt" DESC)',
          current_schema()
        )
      ),
      (
        'SavedMedia_userId_status_createdAt_idx',
        '"SavedMedia"'::regclass,
        format(
          'CREATE INDEX "SavedMedia_userId_status_createdAt_idx" ON %I."SavedMedia" USING btree ("userId", status, "createdAt" DESC)',
          current_schema()
        )
      ),
      (
        'Job_userId_savedMediaId_status_idx',
        '"Job"'::regclass,
        format(
          'CREATE INDEX "Job_userId_savedMediaId_status_idx" ON %I."Job" USING btree ("userId", "savedMediaId", status)',
          current_schema()
        )
      )
  )
  SELECT ARRAY_AGG(expected.index_name ORDER BY expected.index_name)
    INTO invalid_indexes
  FROM expected
  LEFT JOIN LATERAL (
    SELECT catalog.indexrelid AS oid
    FROM pg_index catalog
    JOIN pg_class indexed ON indexed.oid = catalog.indexrelid
    WHERE catalog.indrelid = expected.relation
      AND indexed.relname = expected.index_name
  ) actual ON TRUE
  WHERE actual.oid IS NULL
     OR pg_get_indexdef(actual.oid) IS DISTINCT FROM expected.definition;

  IF COALESCE(cardinality(invalid_indexes), 0) > 0 THEN
    RAISE EXCEPTION
      'SavedMedia repair found missing or incompatible indexes: %',
      invalid_indexes;
  END IF;
END $$;
