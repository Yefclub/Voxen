DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'EnrichmentStatus'
      AND typnamespace = current_schema()::regnamespace
  ) THEN
    CREATE TYPE "EnrichmentStatus" AS ENUM (
      'PENDING',
      'RUNNING',
      'COMPLETE',
      'RETRY',
      'SKIPPED'
    );
  END IF;
END
$$;

ALTER TABLE "Transcript"
  ADD COLUMN IF NOT EXISTS "taggingStatus" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "taggingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taggingStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "taggingNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "taggingError" TEXT;

UPDATE "Transcript" AS t
SET "taggingStatus" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "TranscriptTag" AS tt
    WHERE tt."transcriptId" = t.id
  ) THEN 'COMPLETE'::"EnrichmentStatus"
  ELSE 'PENDING'::"EnrichmentStatus"
END
WHERE t."taggingStatus" = 'PENDING'::"EnrichmentStatus"
  AND t."taggingAttempts" = 0;

CREATE INDEX IF NOT EXISTS "Transcript_taggingStatus_taggingNextAttemptAt_idx"
  ON "Transcript"("taggingStatus", "taggingNextAttemptAt");

-- PostgreSQL considera NULLs distintos em constraints compostas. Como os
-- settings globais usam userId NULL, preservamos o registro mais recente e
-- garantimos uma única linha por chave com um índice parcial.
WITH ranked_global_settings AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY key
      ORDER BY "updatedAt" DESC, id DESC
    ) AS row_number
  FROM "Setting"
  WHERE scope = 'GLOBAL'::"SettingScope"
    AND "userId" IS NULL
)
DELETE FROM "Setting" AS setting
USING ranked_global_settings AS ranked
WHERE setting.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Setting_global_key_unique"
  ON "Setting"(key)
  WHERE scope = 'GLOBAL'::"SettingScope"
    AND "userId" IS NULL;
