-- ============================================================================
-- Telegram bot — vinculação de chat_id ↔ userId
-- ============================================================================
-- Cada user pode vincular sua conta Telegram pra conversar com a Vox via bot.
-- Vínculo feito via código de 6 dígitos gerado no /conta, enviado no /start.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "TelegramLink" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL UNIQUE,
  "chatId"      BIGINT NOT NULL UNIQUE,
  "username"    TEXT,
  "linkedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramLink_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TelegramLink_chatId_idx" ON "TelegramLink"("chatId");
