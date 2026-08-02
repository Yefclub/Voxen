-- Tokens MCP individuais: o segredo nunca é persistido, apenas SHA-256.
CREATE TABLE IF NOT EXISTS "McpToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "scopes" TEXT NOT NULL DEFAULT 'READ',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "McpToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "McpToken_tokenHash_key" ON "McpToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "McpToken_userId_revokedAt_idx" ON "McpToken"("userId", "revokedAt");
CREATE INDEX IF NOT EXISTS "McpToken_expiresAt_idx" ON "McpToken"("expiresAt");
DO $$ BEGIN
  ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
