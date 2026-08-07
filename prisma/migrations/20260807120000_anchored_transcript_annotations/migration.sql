CREATE TYPE "NoteAnchorStatus" AS ENUM ('VALID', 'STALE', 'UNAVAILABLE');

CREATE TABLE "NoteTranscriptAnchor" (
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

CREATE INDEX "NoteTranscriptAnchor_userId_transcriptId_status_idx"
    ON "NoteTranscriptAnchor"("userId", "transcriptId", "status");
CREATE INDEX "NoteTranscriptAnchor_noteId_transcriptId_idx"
    ON "NoteTranscriptAnchor"("noteId", "transcriptId");

ALTER TABLE "NoteTranscriptAnchor"
    ADD CONSTRAINT "NoteTranscriptAnchor_noteId_transcriptId_fkey"
    FOREIGN KEY ("noteId", "transcriptId")
    REFERENCES "NoteTranscriptSource"("noteId", "transcriptId")
    ON DELETE CASCADE ON UPDATE CASCADE;
