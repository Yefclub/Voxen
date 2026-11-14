-- Bundled PostgreSQL module, validated on the supported PostgreSQL 17 image.
-- Its punctuation-insensitive similarity is used only for bounded name discovery.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE INDEX IF NOT EXISTS "PassageIndexSource_title_trgm_idx"
  ON "PassageIndexSource" USING GIST (lower(title) public.gist_trgm_ops(siglen=32));
CREATE INDEX IF NOT EXISTS "BrainNode_label_trgm_idx"
  ON "BrainNode" USING GIST (lower(label) public.gist_trgm_ops(siglen=32));
