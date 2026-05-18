-- ============================================================================
-- Chat memory compaction — schema changes
-- ============================================================================
-- 1) ChatRole ganha SYSTEM (resumos de compactação, futuros jobs etc).
-- 2) Novo enum ChatMessageKind (NORMAL | COMPACTION_SUMMARY).
-- 3) Conversation.compactionCount (default 0).
-- 4) ChatMessage.kind (default NORMAL) + compactedAt (nullable).
-- 5) Index (conversationId, compactedAt) pra queries "ainda válidas".
-- ============================================================================

ALTER TYPE "ChatRole" ADD VALUE IF NOT EXISTS 'SYSTEM';

DO $$ BEGIN
  CREATE TYPE "ChatMessageKind" AS ENUM ('NORMAL', 'COMPACTION_SUMMARY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "compactionCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ChatMessage"
  ADD COLUMN IF NOT EXISTS "kind" "ChatMessageKind" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "compactedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_compactedAt_idx"
  ON "ChatMessage"("conversationId", "compactedAt");
