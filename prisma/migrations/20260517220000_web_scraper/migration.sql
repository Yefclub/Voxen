-- Adiciona suporte a páginas web no scraper Trafilatura (spec 004).
-- ALTER TYPE ... ADD VALUE precisa rodar FORA de transação (Postgres 12+).
-- Diretiva do Prisma desabilita a transação implícita desta migration.
-- prisma-migrate-disable-transaction

ALTER TYPE "TranscriptSource" ADD VALUE IF NOT EXISTS 'WEB';
ALTER TYPE "TranscriptionMethod" ADD VALUE IF NOT EXISTS 'SCRAPE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SCRAPE_WEB';
