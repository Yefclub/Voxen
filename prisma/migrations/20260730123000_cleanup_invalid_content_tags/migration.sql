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
        'looking at the content',
        'the content is about',
        'this content',
        'it''s about',
        'its about',
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

-- TranscriptTag usa ON DELETE CASCADE, então as relações inválidas desaparecem
-- junto com a tag sem afetar o conteúdo ou tags válidas.
DELETE FROM "Tag"
WHERE voxen_invalid_content_tag(name);

-- Conteúdos que ficaram sem nenhuma tag voltam à fila de enriquecimento. O
-- worker existente faz claim idempotente e gera novamente com o parser atual.
UPDATE "Transcript" AS transcript
SET
  "taggingStatus" = 'PENDING'::"EnrichmentStatus",
  "taggingAttempts" = 0,
  "taggingStartedAt" = NULL,
  "taggingNextAttemptAt" = NULL,
  "taggingError" = NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM "TranscriptTag" AS relation
  WHERE relation."transcriptId" = transcript.id
)
AND coalesce(trim(transcript."plainText"), '') <> '';

COMMIT;
