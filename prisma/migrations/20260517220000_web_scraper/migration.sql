-- Adiciona suporte a páginas web no scraper Trafilatura (spec 004).
-- ALTER TYPE ... ADD VALUE é safe + idempotente com IF NOT EXISTS (Postgres 12+).
-- Não pode rodar dentro de transaction; Prisma migrate cuida disso por step.

ALTER TYPE "TranscriptSource" ADD VALUE IF NOT EXISTS 'WEB';
ALTER TYPE "TranscriptionMethod" ADD VALUE IF NOT EXISTS 'SCRAPE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SCRAPE_WEB';
