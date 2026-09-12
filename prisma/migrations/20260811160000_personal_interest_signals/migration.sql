DO $$ BEGIN
  CREATE TYPE "InterestEventOrigin" AS ENUM ('OBSERVED', 'EXPLICIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InterestEventKind" AS ENUM (
    'TRANSCRIPT_VIEWED',
    'PREFERENCE_MORE',
    'PREFERENCE_LESS',
    'PREFERENCE_CLEARED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "InterestEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transcriptId" TEXT NOT NULL,
  "origin" "InterestEventOrigin" NOT NULL,
  "kind" "InterestEventKind" NOT NULL,
  "signal" INTEGER NOT NULL,
  "dedupeKey" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InterestEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InterestEvent_userId_dedupeKey_key"
  ON "InterestEvent"("userId", "dedupeKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Transcript_id_userId_key"
  ON "Transcript"("id", "userId");
CREATE INDEX IF NOT EXISTS "InterestEvent_userId_transcriptId_occurredAt_idx"
  ON "InterestEvent"("userId", "transcriptId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "InterestEvent_userId_origin_occurredAt_idx"
  ON "InterestEvent"("userId", "origin", "occurredAt" DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InterestEvent_semantic_contract_check'
      AND conrelid = '"InterestEvent"'::regclass
  ) THEN
    ALTER TABLE "InterestEvent"
      ADD CONSTRAINT "InterestEvent_semantic_contract_check"
      CHECK (
        (
          "origin" = 'OBSERVED'::"InterestEventOrigin"
          AND "kind" = 'TRANSCRIPT_VIEWED'::"InterestEventKind"
          AND "signal" = 0
          AND "dedupeKey" IS NOT NULL
        )
        OR
        (
          "origin" = 'EXPLICIT'::"InterestEventOrigin"
          AND "dedupeKey" IS NULL
          AND (
            ("kind" = 'PREFERENCE_MORE'::"InterestEventKind" AND "signal" = 1)
            OR ("kind" = 'PREFERENCE_LESS'::"InterestEventKind" AND "signal" = -1)
            OR ("kind" = 'PREFERENCE_CLEARED'::"InterestEventKind" AND "signal" = 0)
          )
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InterestEvent_metadata_object_check'
      AND conrelid = '"InterestEvent"'::regclass
  ) THEN
    ALTER TABLE "InterestEvent"
      ADD CONSTRAINT "InterestEvent_metadata_object_check"
      CHECK (jsonb_typeof("metadata") = 'object');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InterestEvent_userId_fkey'
      AND conrelid = '"InterestEvent"'::regclass
  ) THEN
    ALTER TABLE "InterestEvent"
      ADD CONSTRAINT "InterestEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InterestEvent_transcriptId_userId_fkey'
      AND conrelid = '"InterestEvent"'::regclass
  ) THEN
    ALTER TABLE "InterestEvent"
      ADD CONSTRAINT "InterestEvent_transcriptId_userId_fkey"
      FOREIGN KEY ("transcriptId", "userId") REFERENCES "Transcript"("id", "userId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
