ALTER TABLE "PassageIndexSource" ADD COLUMN IF NOT EXISTS "searchVector" TSVECTOR;
CREATE INDEX IF NOT EXISTS "PassageIndexSource_searchVector_idx"
  ON "PassageIndexSource" USING GIN ("searchVector");
CREATE OR REPLACE FUNCTION voxen_passage_title_vector() RETURNS TRIGGER AS $$
BEGIN
  NEW."searchVector" := to_tsvector('pg_catalog.simple', NEW.title)
    || to_tsvector('pg_catalog.portuguese', NEW.title)
    || to_tsvector('pg_catalog.english', NEW.title);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "PassageIndexSource_vector" ON "PassageIndexSource";
CREATE TRIGGER "PassageIndexSource_vector" BEFORE INSERT OR UPDATE OF title ON "PassageIndexSource"
  FOR EACH ROW EXECUTE FUNCTION voxen_passage_title_vector();
-- Derived metadata only; fresh installations have no source ledgers yet.
UPDATE "PassageIndexSource" SET title = title WHERE "searchVector" IS NULL;
