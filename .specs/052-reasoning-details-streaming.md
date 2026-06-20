# 052 — Streaming de `reasoning_details` (não só `reasoning` string)

## Contexto

O endpoint `/chat` (`apps/chat/src/main.py`) consome o streaming do OpenRouter e
emite eventos SSE `reasoning_token` pra UI mostrar o raciocínio do modelo. Hoje o
loop só lê `delta.reasoning` (campo string). Vários modelos via OpenRouter
devolvem o raciocínio APENAS em `delta.reasoning_details` — uma lista de objetos
estruturados (ex.: `{"type": "reasoning.text", "text": "..."}` ou
`{"type": "reasoning.summary", "summary": "..."}`). Sem tratar essa lista, nenhum
`reasoning_token` é emitido e a UI não mostra raciocínio mesmo com thinking on.

## Glossário

- **delta**: objeto incremental de cada chunk do streaming (OpenAI SDK).
- **reasoning_details**: lista de objetos de raciocínio estruturado do OpenRouter.
  Tipos relevantes: `reasoning.text` (campo `text`), `reasoning.summary` (campo
  `summary`). `reasoning.encrypted` (campo `data`) é cifrado/redacted — ignorado.
- **reasoning_token**: evento SSE que carrega um trecho de raciocínio pra UI.

## Requisitos (EARS)

- **REQ-1** — When `delta.reasoning` (string) vier preenchido em um chunk, the
  sistema shall emitir um evento `reasoning_token` com esse texto.
- **REQ-2** — When `delta.reasoning` estiver vazio/ausente e `delta.reasoning_details`
  (lista) vier preenchido, the sistema shall extrair o texto de cada item
  (`text`, senão `summary`) e emitir um `reasoning_token` com o texto concatenado.
- **REQ-3** — When ambos `delta.reasoning` e `delta.reasoning_details` vierem no
  mesmo chunk, the sistema shall priorizar `delta.reasoning` (string) e NÃO emitir
  duplicado a partir de `reasoning_details` (modelos mandam um OU outro por chunk).
- **REQ-4** — When `delta.reasoning_details` for `None`, lista vazia, ou tiver
  itens sem texto utilizável (sem `text`/`summary`, ou tipo `reasoning.encrypted`),
  the sistema shall não emitir `reasoning_token` e não derrubar o stream.
- **REQ-5** — The extração de `reasoning_details` shall ser tolerante a itens que
  sejam `dict` ou objeto (acesso defensivo via get/getattr) e a formatos
  inesperados (try/except — nunca propaga exceção pro loop de streaming).

## Escopo

- Apenas `apps/chat/src/main.py`. Não tocar `build_reasoning_config` (reasoning
  segue sempre ligado). Não tocar web/worker.

## Critérios de aceite (testes)

- `delta.reasoning` string → emite (REQ-1).
- `reasoning_details` com `reasoning.text` → emite o `text` (REQ-2).
- `reasoning_details` com `reasoning.summary` → emite o `summary` (REQ-2).
- `reasoning` string + `reasoning_details` no mesmo chunk → emite só a string (REQ-3).
- `reasoning_details` None / vazio / item malformado → não emite, não quebra (REQ-4/REQ-5).
- item como objeto (não dict) → extrai via getattr (REQ-5).
