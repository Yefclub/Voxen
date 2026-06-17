-- Persistência de arquivos originais enviados por upload e previews internos.
-- Idempotente para suportar reexecução em ambientes Easypanel/self-hosted.

ALTER TABLE "Transcript"
  ADD COLUMN IF NOT EXISTS "originalObjectKey" TEXT,
  ADD COLUMN IF NOT EXISTS "originalFilename" TEXT,
  ADD COLUMN IF NOT EXISTS "originalMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "previewObjectKey" TEXT,
  ADD COLUMN IF NOT EXISTS "previewMimeType" TEXT;
