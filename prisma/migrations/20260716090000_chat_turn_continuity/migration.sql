DO $$
BEGIN
  CREATE TYPE "ChatTurnStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ChatTurn" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userMessageId" TEXT NOT NULL,
  "assistantMessageId" TEXT NOT NULL,
  "status" "ChatTurnStatus" NOT NULL DEFAULT 'PENDING',
  "errorMsg" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "ChatTurn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatTurn_userMessageId_key" ON "ChatTurn"("userMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChatTurn_assistantMessageId_key" ON "ChatTurn"("assistantMessageId");
CREATE INDEX IF NOT EXISTS "ChatTurn_userId_status_updatedAt_idx" ON "ChatTurn"("userId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "ChatTurn_conversationId_createdAt_idx" ON "ChatTurn"("conversationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ChatTurn_status_updatedAt_idx" ON "ChatTurn"("status", "updatedAt");
