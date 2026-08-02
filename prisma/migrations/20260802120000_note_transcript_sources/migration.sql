-- Proveniência explícita e múltipla das notas curadas.
CREATE TABLE IF NOT EXISTS "NoteTranscriptSource" (
  "noteId" TEXT NOT NULL,
  "transcriptId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoteTranscriptSource_pkey" PRIMARY KEY ("noteId", "transcriptId"),
  CONSTRAINT "NoteTranscriptSource_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NoteTranscriptSource_transcriptId_fkey"
    FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "NoteTranscriptSource_userId_transcriptId_idx"
  ON "NoteTranscriptSource"("userId", "transcriptId");

-- Preserva os vínculos únicos criados antes desta migração.
INSERT INTO "NoteTranscriptSource" ("noteId", "transcriptId", "userId")
SELECT n.id, t.id, n."userId"
FROM "Note" n
JOIN "Transcript" t ON t.id = n."sourceId" AND t."userId" = n."userId"
WHERE n."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
ON CONFLICT ("noteId", "transcriptId") DO NOTHING;
