-- Reconstrói o chat como uma linha do tempo única por usuário.
-- Migração idempotente: consolida legado antes do índice único e preserva
-- mensagens por ordem cronológica, sem apagar o histórico.

DO $$
DECLARE
  duplicate record;
  canonical_id text;
BEGIN
  FOR duplicate IN
    SELECT "userId"
    FROM "Conversation"
    GROUP BY "userId"
    HAVING count(*) > 1
  LOOP
    SELECT id INTO canonical_id
    FROM "Conversation"
    WHERE "userId" = duplicate."userId"
    ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    LIMIT 1;

    UPDATE "ChatMessage"
    SET "conversationId" = canonical_id
    WHERE "conversationId" IN (
      SELECT id FROM "Conversation"
      WHERE "userId" = duplicate."userId" AND id <> canonical_id
    );

    UPDATE "Conversation"
    SET "compactionCount" = greatest(
      "compactionCount",
      coalesce((
        SELECT max("compactionCount")
        FROM "Conversation"
        WHERE "userId" = duplicate."userId"
      ), 0)
    ),
    "transcriptId" = NULL
    WHERE id = canonical_id;

    DELETE FROM "Conversation"
    WHERE "userId" = duplicate."userId" AND id <> canonical_id;
  END LOOP;
END $$;

UPDATE "Conversation" SET "transcriptId" = NULL WHERE "transcriptId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_userId_key" ON "Conversation"("userId");
DROP INDEX IF EXISTS "Conversation_userId_updatedAt_idx";
DROP INDEX IF EXISTS "Conversation_userId_transcriptId_idx";
ALTER TABLE "Conversation" ALTER COLUMN "title" SET DEFAULT 'Vox';
CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx" ON "Conversation"("updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "Conversation_transcriptId_idx" ON "Conversation"("transcriptId");

DO $$ BEGIN
  CREATE TYPE "ChatApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ChatApproval" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "ChatApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "ChatApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatApproval_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ChatApproval_userId_status_expiresAt_idx" ON "ChatApproval"("userId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "ChatApproval_conversationId_createdAt_idx" ON "ChatApproval"("conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "ChatCompactionLease" (
  "conversationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatCompactionLease_pkey" PRIMARY KEY ("conversationId"),
  CONSTRAINT "ChatCompactionLease_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ChatCompactionLease_expiresAt_idx" ON "ChatCompactionLease"("expiresAt");

CREATE TABLE IF NOT EXISTS "ChatStreamLease" (
  "userId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatStreamLease_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "ChatStreamLease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ChatStreamLease_expiresAt_idx" ON "ChatStreamLease"("expiresAt");
