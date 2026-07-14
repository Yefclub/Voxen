---
tipo: fix
titulo: Chat deixa de quebrar no AI SDK 7 com histórico SYSTEM
---

Conversas com resumo de compactação ou resposta HITL voltam a responder
normalmente. O runtime passa a permitir mensagens SYSTEM confiáveis do
servidor no `streamText` e a compactação usa `instructions` em vez de
`system`.
