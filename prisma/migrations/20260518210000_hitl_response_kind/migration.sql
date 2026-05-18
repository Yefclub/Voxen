-- HITL_RESPONSE: marca mensagens originadas de clique nos botões do
-- ConfirmationPrompt. Frontend renderiza essas como pill compacto em vez
-- de bubble cheio — evita poluir a conversa com texto "Sim, pode prosseguir".
ALTER TYPE "ChatMessageKind" ADD VALUE IF NOT EXISTS 'HITL_RESPONSE';
