-- Anexos vinculados à mensagem do usuário no chat (spec 126).
-- Idempotente: o deploy pode reaplicar a migration sem quebrar.
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "attachments" JSONB;
