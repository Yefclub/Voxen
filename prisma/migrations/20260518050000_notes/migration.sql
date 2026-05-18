-- ============================================================================
-- Notes — KB manual em árvore (NOTE | FOLDER) com FTS
-- ============================================================================
-- Tree: parentId FK self-referencing (FOLDER agrupa).
-- FTS: searchVector tsvector mantido por trigger; index GIN.
-- ============================================================================

-- Enum
DO $$ BEGIN
  CREATE TYPE "NoteKind" AS ENUM ('NOTE', 'FOLDER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela
CREATE TABLE IF NOT EXISTS "Note" (
  "id"           TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "parentId"    TEXT,
  "kind"        "NoteKind" NOT NULL DEFAULT 'NOTE',
  "title"       TEXT NOT NULL,
  "content"     TEXT NOT NULL DEFAULT '',
  "searchVector" tsvector,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Note_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Note_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Note_userId_parentId_idx" ON "Note"("userId", "parentId");
CREATE INDEX IF NOT EXISTS "Note_userId_updatedAt_idx" ON "Note"("userId", "updatedAt" DESC);

-- Trigger FTS — title (weighted A) + content (weighted B)
CREATE OR REPLACE FUNCTION update_note_search_vector() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('portuguese', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(NEW."content", '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS note_search_vector_update ON "Note";
CREATE TRIGGER note_search_vector_update
BEFORE INSERT OR UPDATE OF "title", "content" ON "Note"
FOR EACH ROW EXECUTE FUNCTION update_note_search_vector();

CREATE INDEX IF NOT EXISTS "Note_searchVector_idx"
  ON "Note" USING GIN ("searchVector");
