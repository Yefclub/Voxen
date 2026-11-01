-- Tag-weighted transcript FTS (spec 217 §5, issue #898).
-- Previously only title (weight A) and body (weight B) fed searchVector, so a
-- term present only in a document's tags never retrieved it. Tags are
-- curator-assigned topical structure; indexing them at body weight adds
-- recall without disturbing the title-above-body ordering.
-- Idempotent: CREATE OR REPLACE + DROP IF EXISTS. Backfill re-fires the
-- trigger on existing rows without changing stored values. Tag links created
-- afterwards refresh the parent row through transcript_tag_touch_transcript.
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
    setweight(to_tsvector('portuguese',
      CASE WHEN NEW."correctionState" = 'ACTIVE'::"TranscriptCorrectionState"
        THEN coalesce(NEW."correctedPlainText", NEW."plainText", '')
        ELSE coalesce(NEW."plainText", '') END), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcript_search_vector_update ON "Transcript";
CREATE TRIGGER transcript_search_vector_update
BEFORE INSERT OR UPDATE OF "title", "plainText", "correctedPlainText", "correctionState" ON "Transcript"
FOR EACH ROW EXECUTE FUNCTION update_transcript_search_vector();

-- Tag links change a document's indexed terms, so linking/unlinking refreshes
-- the parent row (which re-fires the trigger above). No loop: updating the
-- transcript never touches TranscriptTag.
CREATE OR REPLACE FUNCTION touch_transcript_on_tag_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "Transcript" SET "plainText" = "plainText" WHERE id = OLD."transcriptId";
    RETURN OLD;
  ELSE
    UPDATE "Transcript" SET "plainText" = "plainText" WHERE id = NEW."transcriptId";
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcript_tag_touch_transcript ON "TranscriptTag";
CREATE TRIGGER transcript_tag_touch_transcript
AFTER INSERT OR DELETE ON "TranscriptTag"
FOR EACH ROW EXECUTE FUNCTION touch_transcript_on_tag_change();

-- Backfill: tags were never indexed, so every existing row must be reindexed.
UPDATE "Transcript" SET "plainText" = "plainText";
