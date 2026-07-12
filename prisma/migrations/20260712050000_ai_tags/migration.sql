-- Tags de conteúdo geradas por IA (spec 075).
-- Idempotente: seguro para re-rodar via `prisma migrate deploy`.

-- Tabela de tags (escopo por userId, dedup por slug).
CREATE TABLE IF NOT EXISTS "Tag" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "slug"      TEXT NOT NULL,
  "folderId"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- Dedup por workspace + slug.
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_userId_slug_key" ON "Tag" ("userId", "slug");
-- 1:1 opcional tag -> pasta.
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_folderId_key" ON "Tag" ("folderId");
-- Busca por nome.
CREATE INDEX IF NOT EXISTS "Tag_userId_name_idx" ON "Tag" ("userId", "name");

-- FKs da Tag (condicionais para idempotência).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Tag_userId_fkey'
  ) THEN
    ALTER TABLE "Tag"
      ADD CONSTRAINT "Tag_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Tag_folderId_fkey'
  ) THEN
    ALTER TABLE "Tag"
      ADD CONSTRAINT "Tag_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "LibraryFolder" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Join N:N Transcript <-> Tag.
CREATE TABLE IF NOT EXISTS "TranscriptTag" (
  "transcriptId" TEXT NOT NULL,
  "tagId"        TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptTag_pkey" PRIMARY KEY ("transcriptId", "tagId")
);

CREATE INDEX IF NOT EXISTS "TranscriptTag_tagId_idx" ON "TranscriptTag" ("tagId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TranscriptTag_transcriptId_fkey'
  ) THEN
    ALTER TABLE "TranscriptTag"
      ADD CONSTRAINT "TranscriptTag_transcriptId_fkey"
      FOREIGN KEY ("transcriptId") REFERENCES "Transcript" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TranscriptTag_tagId_fkey'
  ) THEN
    ALTER TABLE "TranscriptTag"
      ADD CONSTRAINT "TranscriptTag_tagId_fkey"
      FOREIGN KEY ("tagId") REFERENCES "Tag" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
