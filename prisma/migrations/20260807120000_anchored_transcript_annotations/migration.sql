DO $$ BEGIN
    CREATE TYPE "NoteAnchorStatus" AS ENUM ('VALID', 'STALE', 'UNAVAILABLE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "NoteTranscriptAnchor" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "startSec" INTEGER,
    "endSec" INTEGER,
    "selectedQuote" TEXT NOT NULL,
    "quoteHash" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 0,
    "sourceChecksum" TEXT,
    "status" "NoteAnchorStatus" NOT NULL DEFAULT 'VALID',
    "staleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteTranscriptAnchor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NoteTranscriptAnchor_userId_transcriptId_status_idx"
    ON "NoteTranscriptAnchor"("userId", "transcriptId", "status");
CREATE INDEX IF NOT EXISTS "NoteTranscriptAnchor_noteId_transcriptId_idx"
    ON "NoteTranscriptAnchor"("noteId", "transcriptId");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'NoteTranscriptAnchor_noteId_transcriptId_fkey'
    ) THEN
        ALTER TABLE "NoteTranscriptAnchor"
            ADD CONSTRAINT "NoteTranscriptAnchor_noteId_transcriptId_fkey"
            FOREIGN KEY ("noteId", "transcriptId")
            REFERENCES "NoteTranscriptSource"("noteId", "transcriptId")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
