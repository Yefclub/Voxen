# Spec 094 — Tool error não trava o Thinking

## Contexto

Quando uma ferramenta falha (throw, job FAILED, ou `{ outcome: 'error' }`), o turno pode terminar com a tool ainda em `running` no JSON persistido. O `ThinkingBlock` trata `running` como “ainda pensando”, e a UI fica eternamente em **Pensando…** (print: raciocínio + “Solicitação de transcrição”).

## Requisitos

### Ubiquitous

- The system shall classify tool outputs with `outcome: 'error'` or a non-empty `error` string as tool state `error`.
- The system shall never persist assistant tool events in state `running` after a turn ends.

### Event-driven

- When `request_transcription` fails, the system shall return a structured `{ outcome: 'error', error }` (not an uncaught throw that can abort the stream without a tool update).
- When the stream ends with leftover `running` tools, the system shall heal them to `error` before persist and emit the updated tool events.
- When loading a chat snapshot, the system shall heal any persisted `running` tools on assistant messages so old stuck turns recover.
- When starting a reply, the system shall emit status **“Buscando na sua biblioteca…”** (not “Consultando seu acervo…”).

### Unwanted behavior

- If a turn has tool errors and no assistant text, then the system shall persist a short fallback message derived from the tool error(s) instead of a generic empty failure when possible.

## Critérios de Aceite

- [ ] Soft error outputs mark `state: 'error'` in the stream handler.
- [ ] `healStaleRunningTools` / segments heal run before persist and on snapshot.
- [ ] Unit tests cover classification + heal.
- [ ] Status copy updated.

## Fora de Escopo

- Changing worker failure rates for X URLs.
- Redesigning ThinkingBlock chrome.
