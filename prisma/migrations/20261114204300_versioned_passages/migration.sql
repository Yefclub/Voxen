-- Additive, keyless derived indexes. Existing source rows are backfilled in
-- bounded application batches, never by object reads inside a migration.
CREATE TABLE IF NOT EXISTS "PassageIndexSource" (
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('transcript', 'note', 'external_enrichment')),
  "sourceId" TEXT NOT NULL,
  generation BIGINT NOT NULL DEFAULT 1 CHECK (generation > 0),
  "indexedGeneration" BIGINT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'READY', 'RETRY', 'FAILED', 'HIDDEN')),
  attempt INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "nextAttemptAt" TIMESTAMP(3),
  revision TEXT, snapshot TEXT, checksum TEXT, title TEXT NOT NULL DEFAULT '',
  limitations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "passageCount" INTEGER NOT NULL DEFAULT 0, "errorCode" TEXT, "indexedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "sourceType", "sourceId")
);
CREATE INDEX IF NOT EXISTS "PassageIndexSource_due_idx"
  ON "PassageIndexSource"(status, "nextAttemptAt", "leaseExpiresAt", "updatedAt");

CREATE TABLE IF NOT EXISTS "RetrievalPassage" (
  key TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  checksum TEXT NOT NULL, text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ORIGINAL', 'SOURCE_DERIVED', 'EXTERNAL_ACCEPTED')),
  authority TEXT, section TEXT,
  "startOffset" INTEGER NOT NULL, "endOffset" INTEGER NOT NULL,
  "startLine" INTEGER NOT NULL, "endLine" INTEGER NOT NULL,
  "startSec" INTEGER, "endSec" INTEGER, "searchVector" TSVECTOR,
  CONSTRAINT "RetrievalPassage_userId_sourceType_sourceId_fkey" FOREIGN KEY ("userId", "sourceType", "sourceId")
    REFERENCES "PassageIndexSource"("userId", "sourceType", "sourceId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "RetrievalPassage_userId_sourceType_sourceId_startOffset_idx"
  ON "RetrievalPassage"("userId", "sourceType", "sourceId", "startOffset");
CREATE INDEX IF NOT EXISTS "RetrievalPassage_searchVector_idx"
  ON "RetrievalPassage" USING GIN ("searchVector");

CREATE OR REPLACE FUNCTION voxen_passage_vector() RETURNS TRIGGER AS $$
BEGIN
  NEW."searchVector" := to_tsvector('pg_catalog.simple', NEW.text)
    || to_tsvector('pg_catalog.portuguese', NEW.text)
    || to_tsvector('pg_catalog.english', NEW.text);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "RetrievalPassage_vector" ON "RetrievalPassage";
CREATE TRIGGER "RetrievalPassage_vector" BEFORE INSERT OR UPDATE OF text ON "RetrievalPassage"
  FOR EACH ROW EXECUTE FUNCTION voxen_passage_vector();

CREATE OR REPLACE FUNCTION voxen_passage_dirty(owner_id TEXT, source_type TEXT, source_id TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO "PassageIndexSource" ("userId", "sourceType", "sourceId")
    VALUES (owner_id, source_type, source_id)
  ON CONFLICT ("userId", "sourceType", "sourceId") DO UPDATE SET
    generation = "PassageIndexSource".generation + 1, status = 'PENDING', attempt = 0,
    "leaseToken" = NULL, "leaseExpiresAt" = NULL, "nextAttemptAt" = NULL,
    "errorCode" = NULL, "updatedAt" = CURRENT_TIMESTAMP;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION voxen_passage_source_changed() RETURNS TRIGGER AS $$
DECLARE source_type TEXT;
BEGIN
  source_type := CASE TG_TABLE_NAME WHEN 'Transcript' THEN 'transcript'
    WHEN 'Note' THEN 'note' ELSE 'external_enrichment' END;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "PassageIndexSource" WHERE "userId" = OLD."userId"
      AND "sourceType" = source_type AND "sourceId" = OLD.id;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."userId" <> NEW."userId" THEN
      DELETE FROM "PassageIndexSource" WHERE "userId" = OLD."userId"
        AND "sourceType" = source_type AND "sourceId" = OLD.id;
    END IF;
    IF TG_TABLE_NAME = 'Transcript' THEN
      IF ROW(OLD."userId", OLD.title, OLD."mdPath", OLD.status, OLD."sourceVersion", OLD."sourceChecksum",
        OLD."correctionRevision", OLD."correctionState", OLD."correctedChecksum", OLD."correctedMarkdown",
        OLD."sourceMetadata"->'producer', OLD."sourceMetadata"->'evidenceManifest')
        IS NOT DISTINCT FROM ROW(NEW."userId", NEW.title, NEW."mdPath", NEW.status, NEW."sourceVersion", NEW."sourceChecksum",
        NEW."correctionRevision", NEW."correctionState", NEW."correctedChecksum", NEW."correctedMarkdown",
        NEW."sourceMetadata"->'producer', NEW."sourceMetadata"->'evidenceManifest') THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME = 'Note' THEN
      IF ROW(OLD."userId", OLD.title, OLD.content, OLD.revision, OLD.kind)
        IS NOT DISTINCT FROM ROW(NEW."userId", NEW.title, NEW.content, NEW.revision, NEW.kind) THEN RETURN NEW; END IF;
    ELSE
      IF ROW(OLD."userId", OLD.title, OLD.content, OLD.revision, OLD.status, OLD."reviewState", OLD."staleReason",
        OLD."expiresAt", OLD."sourceVersion", OLD."sourceChecksum", OLD."transcriptId")
        IS NOT DISTINCT FROM ROW(NEW."userId", NEW.title, NEW.content, NEW.revision, NEW.status, NEW."reviewState", NEW."staleReason",
        NEW."expiresAt", NEW."sourceVersion", NEW."sourceChecksum", NEW."transcriptId") THEN RETURN NEW; END IF;
    END IF;
  END IF;
  -- Folders have no document text. A NOTE -> FOLDER transition still invalidates.
  IF TG_TABLE_NAME = 'Note' AND TG_OP = 'INSERT' THEN
    IF NEW.kind <> 'NOTE' THEN RETURN NEW; END IF;
  END IF;
  PERFORM voxen_passage_dirty(NEW."userId", source_type, NEW.id);
  IF TG_TABLE_NAME = 'Transcript' AND TG_OP = 'UPDATE' THEN
    PERFORM voxen_passage_dirty(e."userId", 'external_enrichment', e.id)
      FROM "TranscriptEnrichment" e WHERE e."transcriptId" = NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Transcript_passages" ON "Transcript";
CREATE TRIGGER "Transcript_passages" AFTER INSERT OR UPDATE OR DELETE ON "Transcript"
  FOR EACH ROW EXECUTE FUNCTION voxen_passage_source_changed();
DROP TRIGGER IF EXISTS "Note_passages" ON "Note";
CREATE TRIGGER "Note_passages" AFTER INSERT OR UPDATE OR DELETE ON "Note"
  FOR EACH ROW EXECUTE FUNCTION voxen_passage_source_changed();
DROP TRIGGER IF EXISTS "TranscriptEnrichment_passages" ON "TranscriptEnrichment";
CREATE TRIGGER "TranscriptEnrichment_passages" AFTER INSERT OR UPDATE OR DELETE ON "TranscriptEnrichment"
  FOR EACH ROW EXECUTE FUNCTION voxen_passage_source_changed();

CREATE OR REPLACE FUNCTION voxen_passage_owner_changed() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE "PassageIndexSource" SET generation = generation + 1, status = 'PENDING', attempt = 0,
      "leaseToken" = NULL, "leaseExpiresAt" = NULL, "nextAttemptAt" = NULL,
      "errorCode" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "User_passages" ON "User";
CREATE TRIGGER "User_passages" AFTER UPDATE OF status ON "User"
  FOR EACH ROW EXECUTE FUNCTION voxen_passage_owner_changed();
