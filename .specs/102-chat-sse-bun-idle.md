# Spec 102 — Chat SSE: keepalive + idleTimeout do Bun

## Contexto

Em produção (Easypanel), colar um link no chat faz o agente chamar
`request_transcription`, que aguarda o job por até 10 minutos. A transcrição
termina no worker, mas o browser mostra **network error** e a resposta final
às vezes não chega ao stream ao vivo.

Causa raiz (confirmada em logs + docs Bun):

1. **`Bun.serve` idleTimeout default = 10s** — fecha a conexão se nenhum byte
   for escrito, mesmo com handler ainda rodando.
2. O keepalive SSE da spec 065 (comentário `: keepalive` a cada ~15s) **foi
   perdido** na reescrita do chat (turno durável / AI SDK in-process).
3. Progresso de `waitForTranscriptJob` emitia status no máximo a cada 10s —
   corrida com o idle de 10s do Bun.

O turno no servidor já é durável (spec 101); o bug é de **transporte** e de UX
do toast de erro.

## Requisitos

### Ubiquitous

- The system shall enviar comentário SSE `: keepalive\n\n` a cada ≤15s de
  ociosidade enquanto o stream de `POST /api/chat` estiver aberto.
- The system shall desabilitar o idle timeout do Bun (`server.timeout(req, 0)`)
  para requests de stream longo (chat SSE e jobs events).
- The system shall elevar `idleTimeout` global do Bun.serve (máx. 255s) como
  rede de segurança para outros streams.
- The system shall emitir progresso de `waitForTranscriptJob` no máximo a cada
  5s enquanto o job estiver pendente.

### Event-driven

- When o cliente perder a conexão de transporte durante um turno ativo, the
  system shall **não** exibir o toast cru "network error" / "Failed to fetch"
  se o snapshot indicar turno ainda em execução — a UI deve mostrar recuperação.
- When o snapshot não tiver turno ativo e a falha for de transporte, the system
  shall exibir mensagem amigável (`chat.streamDisconnected`) em vez do texto
  bruto do browser.

### Unwanted

- If o controller do stream já estiver fechado, then the system shall não
  enfileirar keepalive nem lançar `ERR_INVALID_STATE`.

## Critérios de aceite

- [ ] Keepalive SSE reintroduzido em `apps/web/src/routes/chat.ts`.
- [ ] `idleTimeout` + `server.timeout(req, 0)` em `apps/web/src/index.ts`.
- [ ] Cliente classifica desconexão transitória e recupera via snapshot.
- [ ] Progresso de job de transcrição a cada 5s.
- [ ] Testes unitários cobrem classificação de erro e intervalo de keepalive.

## Fora de escopo

- Mudar o pipeline de download/transcrição.
- Substituir SSE por WebSocket.
