# Spec 177 — Selective research after summarization

## Context

The summary must remain grounded only in the transcript. When material context
is missing, an optional second stage may research the web and create the
reviewable enrichment defined by Spec 175.

## Requirements

### Ubiquitous

- The system shall generate `summaryMd` without web tools or external claims.
- The system shall persist an `OFF`, `MANUAL`, or `AUTO` policy, with `OFF` as
  the safe migration default.
- The system shall use a durable idempotent execution keyed by transcript,
  source version, effective configuration, and trigger mode.
- The system shall expose only `openrouter:web_search` to the research stage,
  with bounded calls, results, tokens, duration, and cost telemetry.

### Event-driven

- When `AUTO` mode is active after a summary is persisted, the system shall let
  the model perform zero or more searches for material gaps.
- When `MANUAL` mode receives a web or MCP action, the system shall queue the
  same durable execution used by automatic mode.
- When valid cited output exists, the system shall persist a `SUGGESTED`
  enrichment and never accept it automatically.
- When the model decides not to research, the system shall record the reason
  without creating artificial context.

### State-driven

- While mode is `OFF`, the system shall not perform research calls or incur
  research cost.
- While execution is pending or running, the system shall expose progress,
  trigger, retry, and cancellation without delaying transcript readiness.

### Unwanted behavior

- If research fails, is cancelled, or returns malformed citations, then the
  system shall preserve ingestion and the valid summary without external
  claims.
- If source or web text contains instructions, then the system shall treat them
  as data and prevent any tool except bounded web search.
- If an obsolete execution finishes after cancellation or source-version
  change, then the system shall prevent late persistence.

## Provider contract

The worker uses two phases. A tool-free planner receives the untrusted source
and may propose at most two short public topics. Application code rejects
multi-line, URL, email, high-entropy, oversized, duplicate, or long verbatim
source queries. Each accepted topic is then sent in its own tool-enabled turn;
that turn never receives the title, summary, transcript, or planner rationale.

Tool-enabled turns expose only the beta OpenRouter server tool
`{ "type": "openrouter:web_search" }`. They pin the Exa engine, one hard-capped
tool use, four cumulative results, 2,000 characters per result, and 1,200
output tokens per request. The complete operation has a 90-second wall-clock
deadline and each provider request has a 40-second network timeout. At most two
application-owned search requests are made. Provider routing rejects prices
above USD 1/M prompt tokens, USD 2/M completion tokens, or USD 0.01 per
request; provider-reported cost plus a conservative Exa allowance is also
rejected above USD 0.50.

Every response must contain finite, non-negative token and cost usage. Search
turns must additionally prove exactly one call through
`usage.server_tool_use.web_search_requests`. Evidence is accepted only from
`message.annotations[].url_citation` with safe HTTP(S) URLs. Missing usage,
malformed output, an unexpected tool-call count, or an over-budget response
fails closed and is never persisted as knowledge.

## Rollback and policy transitions

- Switching to `OFF` cancels queued/retry work, requests cancellation of
  running work, and prevents the worker from claiming research.
- Switching from `AUTO` to `MANUAL` cancels automatic work that has not reached
  a terminal state while preserving explicit user/MCP requests.
- Automatic enqueue and worker claim read the current policy while holding the
  same PostgreSQL transaction advisory lock used by settings writes. A stale
  application snapshot therefore cannot cross a completed policy transition.
- Archiving or trashing a transcript makes every nonterminal enrichment
  unclaimable and cancels it in the same transaction as the parent lifecycle
  update. Restoring the transcript never revives that old execution; a new
  explicit or automatic request is required.
- Every UI, MCP, or automatic enqueue locks the active transcript row through
  creation. Lifecycle updates acquire the same row lock, so concurrent ordering
  can only reject the enqueue or cancel the newly committed work before restore.
- Completed suggestions and accepted context remain inspectable; rollback never
  rewrites the canonical summary. Existing items can be dismissed or deleted
  through the review lifecycle.

## Acceptance criteria

- [x] `OFF`, `MANUAL`, and `AUTO` have persistent, distinct behavior.
- [x] Zero searches is a valid successful result in `AUTO`.
- [x] Valid output creates only a `SUGGESTED` enrichment from Spec 175.
- [x] Automatic and manual triggers share queue, idempotency, and cancellation.
- [x] Failures do not change final ingestion status or a valid summary.
- [x] Cost events distinguish inference, search, result count, and trigger.
- [x] UI, web API, and MCP expose state and regeneration with correct scopes.
- [x] Tests cover zero/multiple decisions, bounds, injection, retry, and
      isolation.

## Out of scope

- Enabling research by default for existing installations.
- Merging external context into the summary.
- Giving write tools to the research model.

## Extensão 2026-08-08 — Fonte original e trilha operacional

### Ubiquitous

- The system shall manter o resumo canônico separado de qualquer contexto externo
  pesquisado.
- The system shall enviar ao planejador somente uma referência pública canônica da
  fonte original, sem credenciais, fragmentos, parâmetros não permitidos ou endereços
  locais e privados.
- The system shall limitar a consulta da fonte original e as pesquisas adicionais pelos
  mesmos limites de chamadas, resultados, duração e custo da pesquisa seletiva.

### Event-driven

- When o planejador detectar contexto material incompleto ou incoerente, the system
  shall permitir que ele solicite a consulta da fonte original validada e até duas
  pesquisas públicas complementares.
- When uma etapa de pesquisa iniciar, mudar ou terminar, the system shall persistir a
  etapa sanitizada no histórico do job de origem e publicá-la para atualização em tempo
  real.
- When a pesquisa produzir evidências citadas válidas, the system shall salvar o
  resultado somente como contexto adicional revisável.

### State-driven

- While a pesquisa ocorrer depois da conclusão da ingestão, the system shall manter o
  percentual operacional do job em 100% e shall não reabrir nem regredir seu estado
  terminal.
- While não existir um job de origem, the system shall concluir o enriquecimento sem
  fabricar uma trilha ou associá-la a outro usuário.

### Unwanted behavior

- If a URL de origem for local, privada, ambígua ou contiver credenciais, then the
  system shall omiti-la de todos os prompts e chamadas de ferramenta.
- If a pesquisa falhar, entrar em nova tentativa ou for cancelada, then the system
  shall registrar apenas o estado operacional sanitizado, sem URL, consulta, conteúdo
  privado ou erro bruto do provedor.
- If uma execução obsoleta tentar concluir, then the system shall descartar o resultado
  e shall não publicar uma etapa de sucesso.

### Critérios de aceitação da extensão

- [x] O planejador recebe a referência pública canônica separada do conteúdo não
      confiável.
- [x] URLs privadas, locais, com credenciais ou parâmetros sensíveis nunca chegam ao
      provedor nem aos eventos.
- [x] A consulta opcional da fonte original e no máximo duas pesquisas complementares
      respeitam o teto total de três chamadas.
- [x] Planejamento, consulta da fonte, pesquisa, organização, dispensa, sucesso,
      tentativa, falha e cancelamento possuem rótulos PT-BR e EN.
- [x] Eventos posteriores ao fim da ingestão permanecem persistidos com 100% sem alterar
      o status terminal do job.
- [x] Pesquisa sem job de origem continua funcional e isolada.
- [x] Testes cobrem fonte segura, fonte rejeitada, ordem da trilha, zero pesquisa,
      sucesso, nova tentativa, falha, cancelamento e descarte obsoleto.

> 2026-08-08: extensão aprovada para consultar a fonte original quando houver lacunas e
> tornar todas as etapas adicionais visíveis na fila.
