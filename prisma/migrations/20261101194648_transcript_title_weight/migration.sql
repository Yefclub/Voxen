-- Title-weighted transcript FTS (spec 217 §5, issue #898).
-- Previously only body text (plainText/correctedPlainText) fed searchVector,
-- so title-only terms never retrieved their document. Mirrors the notes
-- trigger (title weight A, body weight B) so title matches rank deterministically
-- without changing snippet/headline behavior (headline ignores weights).
-- Idempotent: CREATE OR REPLACE + DROP IF EXISTS. Backfill re-fires the
-- trigger on existing rows without changing stored values.
CREATE OR REPLACE FUNCTION update_transcript_search_vector() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('portuguese', coalesce(NEW."title", '')), 'A') ||
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

-- Backfill: title was never indexed, so every existing row must be reindexed.
UPDATE "Transcript" SET "plainText" = "plainText";
