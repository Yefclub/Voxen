ALTER TABLE "Note"
  ADD COLUMN IF NOT EXISTS "sourceType" "BrainSourceType",
  ADD COLUMN IF NOT EXISTS "sourceId" TEXT;

CREATE INDEX IF NOT EXISTS "Note_userId_sourceType_sourceId_idx"
  ON "Note"("userId", "sourceType", "sourceId");
