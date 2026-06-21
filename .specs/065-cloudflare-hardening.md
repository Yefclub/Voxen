# 065 — Hardening atrás do Cloudflare (keepalive SSE + IP real)

## Contexto

Voxen roda atrás do proxy do Cloudflare, que aplica um **idle timeout de ~100s**
em conexões: se nenhum byte trafega na conexão por aproximadamente 100 segundos,
o CF derruba com erro **524 (A timeout occurred)**.

Dois pontos do app sofrem com esse comportamento:

1. **SSE do chat.** O endpoint `POST /api/chat/conversations/:id/send`
   (`apps/web/src/routes/chat.ts`) faz proxy SSE do serviço de chat para o
   browser via `ReadableStream`. Durante **tool calls longas** (web search,
   reasoning) o upstream pode ficar > 100s sem emitir nenhum token. Sem tráfego,
   o Cloudflare corta a conexão (524) e o chat "morre" no meio da resposta.
   O outro SSE do app — jobs (`GET /api/jobs/:id/events` em
   `apps/web/src/routes/jobs.ts`) — **já** envia um heartbeat (`ping`) a cada 10s
   via `SSE_HEARTBEAT_MS`, então não está sujeito ao problema.

2. **IP real do cliente.** O rate-limit por IP (`GET /health/deep` em
   `apps/web/src/index.ts`) deriva o IP de `X-Forwarded-For`. Atrás do Cloudflare,
   o `X-Forwarded-For` pode conter IPs intermediários; o IP canônico do cliente
   real é o header **`CF-Connecting-IP`**. Sem usá-lo, o scoping do rate-limit
   fica impreciso atrás do CF.

Ambos são fixes de baixo risco e alto valor para deploy self-hosted atrás do CF.
Não mexem em contratos de API.

## Glossário

- **SSE**: Server-Sent Events (`text/event-stream`).
- **Comentário SSE**: linha começando com `:` (ex.: `: keepalive\n\n`). O parser
  SSE do browser **ignora** linhas de comentário — não geram evento nem `message`.
  Servem apenas para manter a conexão de transporte viva.
- **Idle timeout do CF**: ~100s sem nenhum byte na conexão → erro 524.
- **`CF-Connecting-IP`**: header que o Cloudflare injeta com o IP real do cliente.

## Requisitos (EARS)

### R1 — Keepalive no SSE do chat

- **R1.1** While o stream SSE do chat está aberto, when nenhum byte do upstream
  é encaminhado por mais de um intervalo de keepalive (~15s), the servidor shall
  enfileirar um comentário SSE (`: keepalive\n\n`) na conexão para o browser,
  evitando que o Cloudflare derrube a conexão por idle (524).
- **R1.2** When dados reais do upstream são encaminhados, the servidor shall
  adiar o próximo keepalive (resetar o temporizador), de modo que o ping só
  ocorra durante ociosidade real.
- **R1.3** The comentário de keepalive shall NÃO ser contabilizado no acúmulo de
  `content`/`tools`/título da resposta persistida — é apenas tráfego de
  transporte e não deve alterar o conteúdo salvo.
- **R1.4** When o stream termina por qualquer caminho (fim do upstream, erro/abort
  do upstream, `cancel()` do browser, ou no `finally`), the servidor shall limpar
  o temporizador de keepalive e shall NÃO enfileirar pings após o controller
  fechar (guardar contra `enqueue` em controller já fechado).

### R2 — IP real do cliente atrás do Cloudflare

- **R2.1** The web shall expor um helper único `clientIp(c)` que retorna o IP do
  cliente preferindo, em ordem: (1) `CF-Connecting-IP`, (2) primeiro IP de
  `X-Forwarded-For`, (3) `X-Real-IP`, (4) fallback `'unknown'`.
- **R2.2** When `CF-Connecting-IP` está presente, the helper shall retorná-lo
  (corrige o scoping do rate-limit atrás do CF).
- **R2.3** When `CF-Connecting-IP` está ausente mas `X-Forwarded-For` tem um ou
  mais IPs, the helper shall retornar o **primeiro** IP da lista, com trim
  (preserva o comportamento atual sem CF).
- **R2.4** When nenhum header de IP está presente, the helper shall retornar
  `'unknown'`.
- **R2.5** Os call sites de rate-limit por IP shall usar `clientIp(c)` em vez de
  ler `X-Forwarded-For` diretamente.

## Critérios de Aceite

- AC1: Durante uma resposta de chat com tool call longa (> 100s sem token), a
  conexão atrás do CF NÃO cai em 524 (validação manual atrás do CF).
- AC2: O conteúdo persistido da mensagem do assistente é idêntico com e sem
  keepalive (o ping não polui o conteúdo).
- AC3: Encerrar a conexão (browser fecha) não gera erro de `enqueue` em controller
  fechado nem vazamento de timer.
- AC4 (testado): `clientIp(c)` prefere `CF-Connecting-IP`; sem ele, usa o primeiro
  IP do `X-Forwarded-For`; sem nenhum header, retorna `'unknown'`.

## Fora de escopo

- Configuração do service worker/PWA e versão.
- Outros call sites de rate-limit que já usam `userId`/recurso como chave (não por
  IP) — não dependem do IP real.
- jobs SSE — já protegido por heartbeat de 10s.
