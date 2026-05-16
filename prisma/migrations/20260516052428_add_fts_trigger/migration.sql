-- ============================================================================
-- FTS (Full-Text Search) trigger + GIN index para Transcript.searchVector
-- ============================================================================
-- O Prisma cria a coluna `searchVector tsvector` (via Unsupported), mas não
-- gerencia trigger nem index GIN. Isso é feito em SQL nativo.
--
-- Estratégia: trigger BEFORE INSERT/UPDATE de "plainText" recalcula
-- searchVector com dicionário 'portuguese'. O agente Agno faz busca FTS
-- via plainto_tsquery + ts_headline (ver docs/TRANSCRIPT-FORMAT.md).
-- ============================================================================

-- Função do trigger: idempotente (CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION update_transcript_search_vector() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('portuguese', coalesce(NEW."plainText", ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: roda BEFORE INSERT OR UPDATE OF plainText
DROP TRIGGER IF EXISTS transcript_search_vector_update ON "Transcript";
CREATE TRIGGER transcript_search_vector_update
BEFORE INSERT OR UPDATE OF "plainText" ON "Transcript"
FOR EACH ROW EXECUTE FUNCTION update_transcript_search_vector();

-- Index GIN no tsvector (não é gerado pelo Prisma)
CREATE INDEX IF NOT EXISTS "Transcript_searchVector_idx"
  ON "Transcript" USING GIN ("searchVector");
