BEGIN;

-- Mantém a limpeza histórica alinhada ao parser do web/worker. A função fica
-- disponível para auditoria e testes de contrato após o deploy.
CREATE OR REPLACE FUNCTION voxen_invalid_content_tag(value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    lower(trim(value)) = ANY (ARRAY[
      'content',
      'conteúdo',
      'conteudo',
      'misc',
      'other',
      'others',
      'outros',
      'geral',
      'general',
      'various',
      'stuff',
      'video',
      'vídeo',
      'tag',
      'tags',
      'none',
      'nenhuma',
      'n/a',
      'na',
      'null',
      'i see'
    ])
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'the content',
        'this content',
        'looking at',
        'it''s about',
        'its about',
        'it is about',
        'the user',
        'i want',
        'i will',
        'i need',
        'let me',
        'here are',
        'here is',
        'the tags',
        'as tags',
        'tags total',
        'json array only',
        'return json only',
        'no duplicates',
        'no sentences',
        'o conteúdo',
        'este conteúdo'
      ]) AS marker
      WHERE position(marker IN lower(trim(value))) > 0
    );
$$;

-- Rotina idempotente e opcionalmente escopada por workspace. O deploy chama
-- sem escopo; testes e reconciliações futuras podem provar o efeito num único
-- usuário sem tocar em dados concorrentes.
CREATE OR REPLACE FUNCTION voxen_cleanup_invalid_content_tags(target_user_id TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- TranscriptTag usa ON DELETE CASCADE, então somente as relações das tags
  -- inválidas desaparecem; conteúdo e tags válidas permanecem.
  DELETE FROM "Tag" AS tag
  WHERE (target_user_id IS NULL OR tag."userId" = target_user_id)
    AND voxen_invalid_content_tag(tag.name);

  -- Conteúdos que ficaram sem nenhuma tag voltam à fila. O worker existente
  -- faz claim idempotente e gera novamente com o parser atual.
  UPDATE "Transcript" AS transcript
  SET
    "taggingStatus" = 'PENDING'::"EnrichmentStatus",
    "taggingAttempts" = 0,
    "taggingStartedAt" = NULL,
    "taggingNextAttemptAt" = NULL,
    "taggingError" = NULL
  WHERE (target_user_id IS NULL OR transcript."userId" = target_user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM "TranscriptTag" AS relation
      WHERE relation."transcriptId" = transcript.id
    )
    AND coalesce(trim(transcript."plainText"), '') <> '';
END;
$$;

SELECT voxen_cleanup_invalid_content_tags(NULL::TEXT);

COMMIT;
