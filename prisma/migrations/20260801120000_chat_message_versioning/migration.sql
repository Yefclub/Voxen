-- Versionamento de mensagens do chat (spec 127).
--
-- Aditiva e idempotente: só colunas novas, nulas em todo o acervo existente, e
-- nenhum backfill. Conversa criada antes desta feature fica com `parentId`
-- nulo em todas as mensagens e continua sendo lida como trilha linear
-- contínua; o encadeamento acontece de forma preguiçosa, por conversa, na
-- primeira escrita estrutural (ver `message-versions.ts`).

ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "parentId" TEXT;

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "activeLeafId" TEXT;

CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_parentId_idx"
  ON "ChatMessage"("conversationId", "parentId");

-- `ADD CONSTRAINT` não aceita IF NOT EXISTS no Postgres; o bloco torna o passo
-- repetível sem falhar quando a constraint já existe.
DO $$
BEGIN
  ALTER TABLE "ChatMessage"
    ADD CONSTRAINT "ChatMessage_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ChatMessage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END
$$;
