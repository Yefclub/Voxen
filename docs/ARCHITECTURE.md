# Arquitetura — Voxen

## Visão geral

Voxen é uma plataforma web self-hosted composta por **3 apps** e **3 serviços de infra**, todos rodando em containers Docker, deployáveis num único `docker-compose.yml` (dev e prod).

```
                                ┌──────────────────────┐
                                │     Browser do user   │
                                │   (React + Vite SPA)  │
                                └──────────┬───────────┘
                                           │ HTTPS
                                           ▼
                            ┌──────────────────────────────┐
                            │           apps/web           │
                            │   Bun + Hono + Vite + React  │
                            │   (front + API + auth)       │
                            └─────┬────────┬───────┬───────┘
                                  │        │       │
                ┌─────────────────┘        │       └─────────────┐
                │                          │                     │
                ▼                          ▼                     ▼
       ┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐
       │    Postgres 17   │   │       apps/chat        │   │     Redis 7     │
       │  (Prisma + FTS)  │   │  Python + FastAPI +     │   │  (ARQ queue,    │
       │  Users, Sessions,│   │  Agno (streaming SSE)   │   │   sessions,     │
       │  Transcripts,    │   │  Tools: list, search,   │   │   rate-limit)   │
       │  Chunks, Jobs,   │   │  read, get_metadata     │   └────────┬────────┘
       │  CostEvents,     │   └──────────┬─────────────┘            │
       │  Settings        │              │                          │
       └──────────────────┘              │                          │
                ▲                        │                          ▼
                │                        │              ┌───────────────────────┐
                │                        │              │      apps/worker      │
                └────────────────────────┴──────────────┤   Python + ARQ +      │
                                                        │   media extractor     │
                                                        │   + ffmpeg            │
                                                        └──────────┬────────────┘
                                                                   │
                                                                   ▼
                                                    ┌──────────────────────────┐
                                                    │       MinIO / S3         │
                                                    │   .md transcripts +      │
                                                    │   thumbnails             │
                                                    └──────────────────────────┘
```

## Os 3 apps

### `apps/web` — Bun + Hono + React (front + API)

Único serviço exposto na borda (porta 3000). Responsabilidades:

- **Front-end**: SPA React (Vite build) com Tailwind v4 + shadcn/ui (zinc). Rotas:
  - `/login`, `/cadastro`, `/setup` (primeiro user), `/aguardando-aprovacao`
  - `/dashboard` (lista de transcrições, biblioteca)
  - `/chat` (chat com agente, consumindo SSE do `apps/chat`)
  - `/transcricao/:id` (renderiza o `.md` com timestamps clicáveis)
  - `/admin/usuarios` (aprovação de cadastros), `/admin/custos` (painel)
- **API HTTP** (Hono routes):
  - `/api/auth/*` — better-auth handlers (email/senha, sessões)
  - `/api/jobs` — POST cria job de download/transcrição, GET lista jobs do user
  - `/api/transcripts` — GET lista (filtros, FTS), GET por id
  - `/api/settings` — GET/PUT settings do user/admin
  - `/api/admin/users` — lista/aprova
  - `/api/admin/costs` — painel
- **Proxy SSE** pra `apps/chat`: rota `/api/chat/stream` faz pipe do SSE do `apps/chat` mantendo a sessão do user

### `apps/chat` — Python + FastAPI + Agno

Serviço interno (porta 8001, só na rede `voxen-net`). Responsabilidades:

- Endpoint `/chat/stream` que recebe `{messages, workspace_id}` e retorna SSE
- Agente Agno configurado com tools (sem embeddings):
  - `list_transcripts(workspace_id)` → metadata
  - `search_transcripts(workspace_id, query)` → Postgres FTS com `ts_headline`
  - `read_transcript(id)` → Markdown completo do storage S3
  - `read_transcript_section(id, from_sec, to_sec)` → recorte
  - `get_metadata(id)` → frontmatter
- Cada chamada loga `cost_events` no Postgres (modelo, tokens, custo OpenRouter)

### `apps/worker` — Python + ARQ + extração de mídia + ffmpeg

Worker assíncrono que consome jobs via Redis (ARQ). Responsabilidades:

- Job `download_and_transcribe(job_id)`:
  1. Carrega job do DB → URL, userId
  2. O extrator de mídia tenta legendas oficiais primeiro
  3. Se legenda OK → pula transcrição, gera `.md` direto
  4. Se não → baixa áudio, `ffmpeg` segmenta em chunks de ~5min com overlap
  5. Pra cada chunk → OpenRouter `/audio/transcriptions` (modelo escolhido pelo admin)
  6. Concatena resultado com timestamps, gera `.md` com frontmatter
  7. Upload `.md` pro MinIO/S3
  8. Insere `transcripts` no Postgres (texto + frontmatter + `tsvector` via trigger)
  9. Deleta vídeo + áudio local (cleanup)
  10. Loga `cost_events`
- Trata SSRF: valida URL antes (allowlist de hosts: youtube.com, youtu.be, instagram.com, tiktok.com, vm.tiktok.com)
- Respeita budget mensal do user (consulta antes de enfileirar OpenRouter)

### Egress de download (agente de proxy residencial)

Quando o Voxen roda numa VPS, o YouTube costuma bloquear downloads de IP de
datacenter. Pra contornar, o egress de extração de mídia pode sair por um **IP
residencial** via um túnel reverso [chisel](https://github.com/jpillora/chisel)
(MIT). O servidor chisel vem **embutido na imagem `voxen-app`** (iniciado pelo
entrypoint, best-effort) e o cliente é a imagem `voxen-proxy-agent`, rodada pelo
operador num host de casa.

Caminho do egress:

```
worker --socks5h://127.0.0.1:1080--> chisel server (voxen-app)
                                          ^ túnel TLS (wss) — proxy ws da web em /_tunnel
                                          |
                              voxen-proxy-agent (IP residencial) --> YouTube/IG/TikTok
```

- O agente residencial **disca de volta** ao Voxen (túnel reverso) na própria URL
  pública no path `/_tunnel`; a web faz proxy do WebSocket pro chisel local. Não
  há subdomínio separado nem porta de controle (8088) exposta publicamente.
- O chisel server abre um SOCKS5 **bindado em `127.0.0.1:1080`** (nunca exposto à
  rede) só enquanto há agente conectado. O worker usa esse SOCKS via o setting
  `yt_dlp_proxy_urls`, gerenciado automaticamente (setado ao gerar o token,
  limpo ao revogar) — não há config manual de proxy.
- **Conexão única**: o port-bind garante um só agente; um 2º tentando bindar
  loga `address already in use`, surfaceado como conflito na UI de Integrações.
- O admin gera o token e acompanha o status ao vivo em **Integrações**; o worker
  loga `proxy-active` (mascarado) por job que usa o proxy. Detalhes de operação
  em [`docs/DEPLOY.md`](DEPLOY.md#agente-de-proxy-residencial); specs 058/059.

## Os 3 serviços de infra

### Postgres 17

- Schema gerenciado por Prisma (`prisma/schema.prisma`)
- FTS via `tsvector` GIN index em `Transcript.search_vector` (dicionário `portuguese`)
- Trigger SQL atualiza `search_vector` quando `plain_text` muda
- Migrations rodam automaticamente no entrypoint do `apps/web`

### Redis 7

- Backend da fila ARQ (`apps/worker`)
- Backend de rate-limit do better-auth (futuro)
- Backend de cache de sessões (opcional)

### MinIO / S3-compatible

- MinIO local no Compose e MinIO externo no Easypanel
- Bucket `voxen-transcripts` armazena `.md` e thumbnails
- Bucket criado automaticamente no Compose via `minio-init`
- Credenciais via `S3_*` no `.env` ou Environment do Easypanel

## Fluxos principais

### Setup inicial (primeiro user)

```
1. DB vazio
2. User acessa /cadastro, preenche nome+email+senha
3. Backend: count(users) == 0 → marca admin=true, status=approved
4. Login → redireciona pra /setup (obrigatório enquanto Settings.GLOBAL.openrouter_api_key == null)
5. Admin cola apenas a OR API key; o backend valida o catálogo disponível para essa chave e salva, na mesma transação, a chave cifrada e os modelos recomendados
6. Sistema pronto pra receber outros cadastros (pending)
```

Depois do onboarding, o admin ainda pode ajustar individualmente os modelos em
`/admin/configuracao`. O fluxo inicial permanece propositalmente simples.

Spec completa: `.specs/000-setup-inicial.md`.

### Cadastro de novo user (após admin existir)

```
1. User acessa /cadastro
2. Backend cria User(status=pending)
3. User tenta login → vê /aguardando-aprovacao
4. Admin vai em /admin/usuarios, vê pendente, aprova (+budget mensal)
5. User refresha login → entra no /dashboard com workspace vazio
```

### Job: download + transcrição

```
1. User cola URL em /dashboard, POST /api/jobs
2. apps/web cria Job(status=queued, userId, source_url)
3. apps/web enfileira em ARQ (Redis): "download_and_transcribe", jobId
4. apps/worker consome:
   - Valida URL (allowlist hosts → previne SSRF)
   - extrator de mídia tenta legendas oficiais
   - Se não, baixa áudio + ffmpeg chunking + OpenRouter transcribe
   - Gera .md com frontmatter + timestamps clicáveis
   - Upload .md pro S3 (key: workspaces/<userId>/transcripts/<id>.md)
   - INSERT Transcript no Postgres (plain_text + frontmatter)
   - Trigger SQL atualiza search_vector
   - Cleanup local (deleta video/audio)
   - Log cost_events
   - UPDATE Job(status=done, transcriptId)
5. apps/web mostra notificação ao user (polling em /api/jobs/:id)
```

### Chat com agente

```
1. User abre /chat e envia uma pergunta
2. apps/web persiste a mensagem e pré-busca títulos, resumos e tags relevantes via Postgres FTS
3. O agente AI SDK recebe só essas sugestões compactas e usa tools progressivas para confirmar
4. Para fatos atuais, usa web_search; para X, search_x com o modelo Grok configurado
5. Para uma URL nova, request_transcription aguarda o worker e retorna brief (summary + tags + related)
6. O agente abre outline/linhas/seções e só lê o documento completo como último recurso
7. Texto, raciocínio e tools chegam por SSE e são persistidos como segmentos cronológicos
8. Um reload restaura a mesma timeline; raciocínio persistido nunca volta ao contexto do modelo
9. cost_events registra chat, pesquisa web/X, resumo e organização
```

As pastas ligadas a tags são associações virtuais N:N: `Transcript.folderId`
continua sendo a pasta primária, mas listagem e contagem unem esse vínculo com
`TranscriptTag -> Tag.folderId` sem duplicar conteúdos.

### Painel de custos

```
1. User acessa /admin/custos (ou /custos pro próprio user)
2. apps/web query cost_events agregado:
   - SUM(cost_usd) GROUP BY (date, user_id, kind, model)
3. UI mostra: total do mês, breakdown por kind, top users (admin), histórico
4. Alerta se algum user atingiu >80% do budget
```

## Decisões arquiteturais

Cada decisão grande é documentada como ADR em `docs/DECISIONS.md`. Resumo:

1. **Pivô Electron → Web** — soberania, fácil compartilhar
2. **Monorepo pnpm + Makefile** — TS+Python sem Turbo
3. **Agno > AI SDK** — multi-agent, memória, RAG nativos no Python
4. **Postgres FTS > pgvector** (harness/Karpathy) — agente usa tools, não vector RAG
5. **ARQ > BullMQ** — worker em Python (extração de mídia + ffmpeg nativos)
6. **MinIO/S3-compatible** — padrão único para local, VPS e Easypanel
7. **better-auth + workflow aprovação** — adoção restrita por design
8. **Master key via env** — `MASTER_KEY` em todos os modos documentados
9. **Cliente SSE custom no front** (sem AI SDK) — Agno não tem stream protocol compat
