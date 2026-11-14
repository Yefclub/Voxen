-- Keep the existing SQL-managed full-text indexes and legacy evidence intact.
DO $$
BEGIN
  CREATE TYPE "BrainEvidenceAuthority" AS ENUM ('CAPTURED_SOURCE', 'USER_CORRECTED', 'PREPARED_DOCUMENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "BrainSource"
  ADD COLUMN IF NOT EXISTS "authority" "BrainEvidenceAuthority";
