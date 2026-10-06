-- CreateIndex
CREATE INDEX IF NOT EXISTS "McpOauthAuditEvent_createdAt_id_idx" ON "McpOauthAuditEvent"("createdAt" DESC, "id" DESC);
