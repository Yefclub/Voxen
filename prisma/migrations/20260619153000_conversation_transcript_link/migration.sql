-- Conversa contextual por transcrição: link opcional Conversation -> Transcript.
-- Idempotente (IF NOT EXISTS / guard) conforme padrão de migrations do Voxen.

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "transcriptId" TEXT;

CREATE INDEX IF NOT EXISTS "Conversation_userId_transcriptId_idx"
  ON "Conversation" ("userId", "transcriptId");

-- FK com SET NULL: deletar a transcrição não apaga a conversa (vira chat geral).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_transcriptId_fkey'
  ) THEN
    ALTER TABLE "Conversation"
      ADD CONSTRAINT "Conversation_transcriptId_fkey"
      FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
