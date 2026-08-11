DO $$
BEGIN
  CREATE TYPE "InterestProjectionHorizon" AS ENUM ('SHORT', 'MEDIUM', 'LONG');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "InterestProjection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "horizon" "InterestProjectionHorizon" NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "windowDays" INTEGER NOT NULL,
  "halfLifeDays" INTEGER NOT NULL,
  "items" JSONB NOT NULL DEFAULT '[]',
  "eventCount" INTEGER NOT NULL DEFAULT 0,
  "eventWatermark" TIMESTAMP(3),
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InterestProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InterestProjection_userId_horizon_key"
  ON "InterestProjection"("userId", "horizon");

CREATE INDEX IF NOT EXISTS "InterestProjection_userId_computedAt_idx"
  ON "InterestProjection"("userId", "computedAt" DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InterestProjection_userId_fkey'
      AND conrelid = '"InterestProjection"'::regclass
  ) THEN
    ALTER TABLE "InterestProjection"
      ADD CONSTRAINT "InterestProjection_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'InterestProjection_semantic_contract_check'
      AND conrelid = '"InterestProjection"'::regclass
  ) THEN
    ALTER TABLE "InterestProjection"
      ADD CONSTRAINT "InterestProjection_semantic_contract_check"
      CHECK (
        "windowDays" > 0
        AND "halfLifeDays" > 0
        AND "eventCount" >= 0
        AND length("algorithmVersion") > 0
        AND jsonb_typeof("items") = 'array'
      );
  END IF;
END $$;
