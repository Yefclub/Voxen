# Spec 002 — Download e Transcrição de Vídeos

## Contexto

A funcionalidade central do Voxen: o user cola uma URL de vídeo (YouTube no MVP) num formulário web; o sistema enfileira um job; o worker baixa o áudio, decide entre baixar legendas oficiais OU transcrever via OpenRouter audio, e gera um `.md` no formato canônico (vide `docs/TRANSCRIPT-FORMAT.md`). O resultado fica disponível na knowledge-base do user para que o chat-agente Agno (PR seguinte) navegue via tools.

Esta spec cobre o pipeline **fim-a-fim**: submissão → fila → download → escolha de método → transcrição/fallback → upload Garage → registro Postgres → notificação de progresso em tempo real via SSE.

Referências:
- `docs/TRANSCRIPT-FORMAT.md` — formato do `.md` e layout S3 (`workspaces/<userId>/transcripts/<transcriptId>.md`)
- `docs/ARCHITECTURE.md` — fluxo geral
- ADR-004 (sem embeddings — harness)
- Spec 000 (setup) — `Settings.GLOBAL.openrouter_api_key` e `default_transcription_model` são pré-requisitos

## Glossário

- **Job**: linha em `Job` com `type=DOWNLOAD_AND_TRANSCRIBE`, status `QUEUED|RUNNING|DONE|FAILED|CANCELLED`
- **Transcript**: linha em `Transcript` + `.md` no Garage; criado quando o job termina com sucesso
- **Método de transcrição**: `SUBTITLES` (legendas oficiais baixadas direto via yt-dlp) ou `API` (áudio enviado pra OpenRouter)
- **Workspace**: `userId`; toda transcrição/job/CostEvent é amarrado a um user
- **Chunk**: janela de 10 minutos de áudio com 1s de overlap com o próximo
- **Backoff exponencial**: 1s → 2s → 4s entre tentativas (máx 3 tentativas)

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall accept job submissions only from authenticated users with `status=APPROVED`.
- The system shall scope every job, transcript and cost event to the submitting `userId`; cross-workspace reads are forbidden.
- The system shall persist the canonical transcript as a Markdown file in Garage under `workspaces/<userId>/transcripts/<transcriptId>.md`, following the schema in `docs/TRANSCRIPT-FORMAT.md`.
- The system shall mirror the transcript's `plainText` (untimestamped body) and `frontmatter` (YAML parsed as JSON) into Postgres `Transcript`, keeping the FTS `tsvector` in sync via the existing SQL trigger.
- The system shall record one `CostEvent` per OpenRouter audio call (one per chunk for chunked videos), with `kind=TRANSCRIBE`, the model used, the USD cost reported by OpenRouter, and `jobId` populated.
- The system shall use `Settings.GLOBAL.default_transcription_model` for every transcription; per-job model override is not exposed in the MVP.
- The system shall use Whisper auto-detect for language (no language hint sent on the API call).
- The system shall extract audio as `opus` mono 16 kHz 32 kbps before sending to OpenRouter.

### Event-driven

- **When** an authenticated, approved user submits a valid YouTube URL to `POST /api/jobs`, the system shall create a `Job` with `status=QUEUED`, enqueue it on the ARQ queue, and return `{ jobId, status: 'QUEUED' }` with HTTP 201.
- **When** the worker picks a queued job, the system shall transition it to `status=RUNNING`, set `startedAt=now()`, and publish a `running` progress event.
- **When** the worker finishes successfully, the system shall create the `Transcript`, link `Job.transcriptId`, set `status=DONE` and `finishedAt=now()`, and publish a final `done` progress event with `transcriptId`.
- **When** the worker fails permanently (after retries exhausted or non-retryable error), the system shall set `status=FAILED`, populate `errorMsg`, set `finishedAt=now()`, and publish a final `failed` progress event with the error message.
- **When** an OpenRouter audio call returns a successful response, the system shall insert a `CostEvent` immediately, before processing the next chunk.

### State-driven

- **While** a job is `RUNNING`, the system shall publish progress events to the Redis pub/sub channel `jobs:<userId>:<jobId>` with stages (`downloading | extracting_audio | choosing_method | transcribing | uploading | indexing`), an optional `percent` (0–100) and an optional `chunkIndex`.
- **While** the web app is serving `GET /api/jobs/:jobId/events` for an authenticated user that owns the job, the system shall stream Server-Sent Events from the same Redis channel until the job reaches a terminal state (`DONE`, `FAILED`, or `CANCELLED`), then close the connection.
- **While** a transcription via API runs on audio longer than 10 minutes, the system shall split it into 10-minute chunks with 1 s overlap, transcribe each chunk, and reassemble timestamps globally (chunk N timestamps offset by `N * (10 min − 1 s)`).
- **While** `Settings.GLOBAL.openrouter_api_key` is null (setup incomplete), the system shall reject job submissions with HTTP 412 `{ error: "Setup incompleto. Aguarde o administrador concluir a configuração." }`.

### Optional

- **Where** the YouTube video provides official subtitles in any language, the system shall prefer `transcription_method=SUBTITLES` and skip OpenRouter entirely (no cost, no audio extraction).
- **Where** the user has `monthlyBudgetUsd` set AND the user's current-month `CostEvent.costUsd` sum would exceed it if this job were the cost of an average prior job, the system shall reject the submission with HTTP 402 `{ error: "Limite mensal de gastos atingido." }`.

### Unwanted behavior

- **If** the submitted URL does not match a supported YouTube pattern (`youtu.be/<id>`, `youtube.com/watch?v=<id>`, `youtube.com/shorts/<id>`), the system shall reject with HTTP 400 `{ error: "URL não suportada — use um link do YouTube." }` and shall not create a job.
- **If** the duration probed by yt-dlp exceeds 4 hours (14 400 seconds), the system shall reject the job during execution with `errorMsg="Vídeo excede a duração máxima de 4 horas."` and set `status=FAILED`.
- **If** yt-dlp fails to download (private, geoblocked, removed, or network), the system shall retry up to 3 times with exponential backoff (1 s, 2 s, 4 s), and on permanent failure set `status=FAILED` with `errorMsg` reflecting the upstream cause.
- **If** the OpenRouter API returns 401/403, the system shall set the job `status=FAILED` with `errorMsg="Chave da OpenRouter rejeitada — admin precisa revalidar."` and shall not retry.
- **If** the OpenRouter API returns 5xx or times out, the system shall retry up to 3 times with exponential backoff.
- **If** the upload to Garage fails, the system shall retry up to 3 times with exponential backoff; on permanent failure the system shall set `status=FAILED`, populate `errorMsg`, and shall not create the `Transcript` row.
- **If** a user submits a URL while a `RUNNING` or `QUEUED` job already exists for that `(userId, url)`, the system shall return HTTP 409 `{ error: "Esta URL já está sendo processada." }` and shall not enqueue a duplicate.
- **If** the same URL already has a `Transcript` for the user, the system shall return HTTP 409 `{ error: "Você já transcreveu esta URL.", transcriptId: <id> }`.
- **If** an unauthenticated request hits `POST /api/jobs` or `GET /api/jobs/:id` or `GET /api/jobs/:id/events`, the system shall return HTTP 401.
- **If** a user requests a job that belongs to another user, the system shall return HTTP 404 (not 403, to avoid leaking existence).

## Critérios de Aceite

- [ ] `POST /api/jobs { url }` cria Job + enfileira no ARQ + retorna `{ jobId, status: 'QUEUED' }` para user autenticado e aprovado
- [ ] Worker consome ARQ; transição QUEUED → RUNNING → DONE/FAILED é atômica com timestamps corretos
- [ ] URL do YouTube com legendas oficiais: gera `.md` com `transcription_method=SUBTITLES`, SEM CostEvent, SEM chamada à OpenRouter
- [ ] URL sem legendas: extrai áudio opus 16 kHz mono 32 kbps, chama OpenRouter com Whisper (sem hint de idioma), monta `.md` com timestamps clicáveis, cria CostEvent por chunk
- [ ] Vídeo longo (> 10 min): chunking em janelas de 10 min com 1 s overlap; timestamps no `.md` são globais e crescentes
- [ ] `.md` no Garage segue `docs/TRANSCRIPT-FORMAT.md` (frontmatter completo, corpo `[hh:mm:ss](youtu.be/<id>?t=<s>)`)
- [ ] Postgres `Transcript.plainText` populada (corpo sem timestamps nem frontmatter); `Transcript_searchVector_idx` retorna a transcrição em `plainto_tsquery('portuguese', ...)`
- [ ] `GET /api/jobs/:id` autenticado + escopado por `userId` retorna status + last progress event
- [ ] `GET /api/jobs/:id/events` (SSE) entrega eventos em tempo real do Redis pub/sub `jobs:<userId>:<jobId>` até o job terminar; outros users → 404
- [ ] Submeter mesma URL com job RUNNING/QUEUED → 409; com Transcript já existente → 409 + `transcriptId`
- [ ] URL não-YouTube → 400; URL malformada → 400
- [ ] OpenRouter 401/403 → FAILED + mensagem admin-action, sem retry
- [ ] OpenRouter 5xx → retry 3x com backoff 1/2/4 s; persistência de erro só após esgotar tentativas
- [ ] yt-dlp / Garage erros transientes → mesmo retry
- [ ] Setup incompleto → 412 ao submeter
- [ ] Budget excedido (se `monthlyBudgetUsd` setado) → 402
- [ ] Vídeo > 4h → FAILED com mensagem PT-BR específica
- [ ] Outro user tenta acessar Job → 404 (não 403)
- [ ] Testes: unit (parser de URL YouTube, chunking de timestamps, montagem de `.md`), integration (job lifecycle com yt-dlp mockado + OR mockada + Garage local/mock), e2e parcial (submit → ver evento SSE chegando — fora de PR 8 se UI não estiver pronta; nesse caso curl simulando o cliente)

## Fora de Escopo

- Reprocessar transcrição existente (overwrite)
- Edição manual da transcrição depois de gerada

## Atualizações pós-implementação

- **2026-05-17** — Instagram e TikTok saíram do "fora de escopo" e foram
  implementados (PR #45). MVP cobre apenas vídeos **públicos** das 3
  plataformas (sem cookies/login). Privados/idade-restritos falham com
  mensagem clara do yt-dlp.
- Parser unificado: `apps/web/src/lib/video-url.ts` (TS) +
  `apps/worker/src/video_url.py` (Python) + `apps/chat/src/tools.py::_canonical_video_url`.
- `_timestamp_link` no `transcript_md.py` degrada graciosamente para
  Insta/TikTok: como não há deeplink público pra segundo exato, os links
  caem na URL completa do vídeo (clique abre o vídeo, user procura o
  trecho). Apenas YouTube tem `?t=N`.
- **2026-05-17** — Cancelamento manual de RUNNING implementado (PR #18) via
  `POST /api/jobs/:id/cancel` + canal Redis `jobs:cancel` + checkpoints
  cooperativos no pipeline. `status=CANCELLED` ativo.
- Re-transcribe com outro modelo
- Tradução de transcrição
- Streaming do áudio (download incremental) — sempre baixa arquivo completo antes
- Upload manual de arquivo de áudio/vídeo (futuro)
- Webhooks externos (notificações fora do app)
- Override de modelo por job (sempre usa `default_transcription_model`)
- UI da lista de jobs / submissão (esta spec cobre só backend; UI vem com o scaffolding Vite/React)

## Decisões Tomadas (referência rápida)

| Decisão | Valor |
|---|---|
| Plataformas MVP | YouTube apenas |
| Estratégia de progresso | SSE (`GET /api/jobs/:id/events`) com Redis pub/sub `jobs:<userId>:<jobId>` |
| Duração máxima | 4 horas |
| Janela de chunk | 10 minutos com 1 s de overlap |
| Formato de áudio extraído | opus mono 16 kHz 32 kbps |
| Retry policy | 3 tentativas, backoff 1/2/4 s; 401/403 OR não retentam |
| Idioma | auto-detect via Whisper (sem hint) |
| CostEvent | inserido após cada call OR (per-chunk) |
| Deduplicação | estrita por `(userId, url)` para jobs ativos e Transcripts |
| Modelo de transcrição | sempre `Settings.GLOBAL.default_transcription_model` |

## Histórico

> 2026-05-16: spec rascunhada para co-autoria com o user. Decisões pendentes marcadas no bloco "Riscos / Decisões pendentes".
> 2026-05-16: decisões aprovadas pelo owner (YT-only no MVP, SSE, 4h, propostas técnicas padrão). Spec finalizada com bloco "Decisões Tomadas" como referência rápida.
> 2026-05-17: PR `feat/jobs-api` (PR 8a) implementa o **backend web**: `POST /api/jobs`, `GET /api/jobs(/:id)`, SSE em `/api/jobs/:id/events`, dedup atômico (partial unique index), 401/403/404/409/412 conforme spec, 19 testes.
> 2026-05-17: PR `feat/worker-pipeline` (PR 8b) implementa o **worker fim-a-fim**: subscribe Redis `jobs:new` + reconciliation loop, claim com `SELECT FOR UPDATE SKIP LOCKED`, yt-dlp probe + decisão SUBTITLES vs API, chunking 10min/1s overlap via ffmpeg, OpenRouter audio com retry exp backoff, geração `.md` no formato canônico, upload Garage via aioboto3, insert Transcript + CostEvent por chunk, eventos de progresso em `jobs:<userId>:<jobId>`. Stack Python: asyncpg + aioboto3 + httpx + redis (asyncio) + yt-dlp + pyyaml. 32 testes (transcript_md, parser VTT/SRT, storage mock, crypto).
