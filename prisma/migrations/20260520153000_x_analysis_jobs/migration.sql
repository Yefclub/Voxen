-- Add native X analysis jobs powered by Grok/OpenRouter search.
ALTER TYPE "TranscriptionMethod" ADD VALUE IF NOT EXISTS 'X_SEARCH';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ANALYZE_X';
ALTER TYPE "CostEventKind" ADD VALUE IF NOT EXISTS 'X_SEARCH';
