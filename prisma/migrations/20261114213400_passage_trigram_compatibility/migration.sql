-- Prisma's repeated shadow reset cannot reliably introspect customized GiST
-- signature options. Default signatures retain the same exact rechecks.
BEGIN;
DROP INDEX IF EXISTS "PassageIndexSource_title_trgm_idx";
CREATE INDEX IF NOT EXISTS "PassageIndexSource_title_trgm_idx"
  ON "PassageIndexSource" USING GIST (lower(title) public.gist_trgm_ops);
DROP INDEX IF EXISTS "BrainNode_label_trgm_idx";
CREATE INDEX IF NOT EXISTS "BrainNode_label_trgm_idx"
  ON "BrainNode" USING GIST (lower(label) public.gist_trgm_ops);
COMMIT;
