-- Stable keyset ordering; preserve the independently managed full-text indexes.
CREATE INDEX IF NOT EXISTS "Note_userId_createdAt_id_idx" ON "Note"("userId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Transcript_userId_status_createdAt_id_idx" ON "Transcript"("userId", "status", "createdAt" DESC, "id" DESC);
