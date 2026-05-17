-- Adiciona suporte a páginas web no scraper Trafilatura (spec 004).
-- ALTER TYPE ADD VALUE só falha em transação se o valor for USADO na mesma
-- transação. Esta migration apenas adiciona os valores (sem usá-los em
-- INSERT/etc), então roda OK dentro da transação que o Prisma envelopa.

ALTER TYPE "TranscriptSource" ADD VALUE IF NOT EXISTS 'WEB';
ALTER TYPE "TranscriptionMethod" ADD VALUE IF NOT EXISTS 'SCRAPE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SCRAPE_WEB';
