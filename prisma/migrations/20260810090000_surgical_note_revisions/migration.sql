DO $$ BEGIN
  CREATE TYPE "NoteRevisionActor" AS ENUM ('USER', 'MCP', 'CHAT', 'RESTORE', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Note"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "NoteRevision" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "actor" "NoteRevisionActor" NOT NULL,
  "changeSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoteRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NoteRevision_noteId_revision_key"
  ON "NoteRevision"("noteId", "revision");
CREATE INDEX IF NOT EXISTS "NoteRevision_userId_noteId_createdAt_idx"
  ON "NoteRevision"("userId", "noteId", "createdAt" DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'NoteRevision_userId_fkey'
      AND conrelid = '"NoteRevision"'::regclass
  ) THEN
    ALTER TABLE "NoteRevision"
      ADD CONSTRAINT "NoteRevision_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'NoteRevision_noteId_fkey'
      AND conrelid = '"NoteRevision"'::regclass
  ) THEN
    ALTER TABLE "NoteRevision"
      ADD CONSTRAINT "NoteRevision_noteId_fkey"
      FOREIGN KEY ("noteId") REFERENCES "Note"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "NoteRevision" (
  "id", "userId", "noteId", "revision", "title", "content", "checksum", "actor", "changeSummary", "createdAt"
)
SELECT
  'bootstrap:' || n.id,
  n."userId",
  n.id,
  1,
  n.title,
  n.content,
  md5(n.title || E'\n--- voxen note content ---\n' || n.content),
  'SYSTEM'::"NoteRevisionActor",
  'Initial revision backfilled during migration',
  n."createdAt"
FROM "Note" n
ON CONFLICT ("noteId", "revision") DO NOTHING;
