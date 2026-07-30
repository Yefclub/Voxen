BEGIN;

-- Remove rótulos que vieram de instruções/raciocínio do modelo em builds
-- anteriores. TranscriptTag usa ON DELETE CASCADE, então as relações inválidas
-- desaparecem junto com a tag sem afetar o conteúdo.
DELETE FROM "Tag"
WHERE lower(trim(name)) IN (
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
  'i see',
  'tags total',
  'json array only',
  'return json only',
  'no duplicates',
  'no sentences'
)
OR lower(name) LIKE '%looking at the content%'
OR lower(name) LIKE '%the content is about%'
OR lower(name) LIKE '%this content%'
OR lower(name) LIKE '%the tags%'
OR lower(name) LIKE '%as tags%';

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
