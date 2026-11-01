-- Folder-weighted transcript FTS (spec 217 §5, issue #898).
-- Collection names are structural context, like tags: a term present only in
-- the parent folder never retrieved its documents. Folders are indexed with
-- weight B, like tags and body text; titles keep weight A.
-- Idempotent: CREATE OR REPLACE + DROP IF EXISTS. Backfill re-fires the
-- trigger without changing stored values. Folder moves re-fire the trigger
-- through the "folderId" column (same trigger also covers manual updates).
CREATE OR REPLACE FUNCTION update_transcript_search_vector() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('portuguese', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce((
      SELECT string_agg(tag.name, ' ' ORDER BY tag.name)
      FROM "TranscriptTag" tt
      JOIN "Tag" tag ON tag.id = tt."tagId" AND tag."userId" = NEW."userId"
      WHERE tt."transcriptId" = NEW.id
    ), '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce((
      SELECT folder.name
      FROM "LibraryFolder" folder
      WHERE folder.id = NEW."folderId" AND folder."userId" = NEW."userId"
    ), '')), 'B') ||
    setweight(to_tsvector('portuguese',
      CASE WHEN NEW."correctionState" = 'ACTIVE'::"TranscriptCorrectionState"
        THEN coalesce(NEW."correctedPlainText", NEW."plainText", '')
        ELSE coalesce(NEW."plainText", '') END), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcript_search_vector_update ON "Transcript";
CREATE TRIGGER transcript_search_vector_update
BEFORE INSERT OR UPDATE OF "title", "plainText", "correctedPlainText", "correctionState", "folderId" ON "Transcript"
FOR EACH ROW EXECUTE FUNCTION update_transcript_search_vector();

-- Collection renames change indexed terms too: touch member documents so
-- their vectors refresh through the same trigger.
CREATE OR REPLACE FUNCTION touch_transcripts_on_folder_rename() RETURNS trigger AS $$
BEGIN
  UPDATE "Transcript" SET "plainText" = "plainText" WHERE "folderId" = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS library_folder_touch_transcripts ON "LibraryFolder";
CREATE TRIGGER library_folder_touch_transcripts
AFTER UPDATE OF "name" ON "LibraryFolder"
FOR EACH ROW EXECUTE FUNCTION touch_transcripts_on_folder_rename();

-- Backfill: folder names were never indexed, so every existing row must be
-- re-indexed without changing stored values.
UPDATE "Transcript" SET "plainText" = "plainText";
