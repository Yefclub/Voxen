# Architecture Decision Records — Voxen

Cada ADR captura uma decisão arquitetural significativa, o contexto que a motivou, alternativas consideradas e consequências. Adicionar nova ADR quando uma decisão grande for tomada — usar próxima numeração.

---

## ADR-001 — Pivô Electron → Web

**Data**: 2026-05-14
**Status**: Aceita

### Contexto

Voxen começou como aplicação Electron desktop com Python sidecar pra transcrição local via WhisperX/CUDA. Após 79 commits e 10 releases (v0.1.x → v0.2.5), avaliou-se que o modelo desktop tinha limitações:

- Instalação complexa (Electron + CUDA + WhisperX)
- Dificulta compartilhamento e colaboração
- Suporte por plataforma (Windows/Mac/Linux) consome esforço desproporcional
- Não escala pra múltiplos usuários simultâneos

### Decisão

Reescrever como **plataforma web self-hosted**, deployável em container único via Docker Compose. Repositório anterior arquivado como `Voxen-electron-legacy` (private, read-only). Nova base começou em 2026-05-15.

### Consequências

- Setup do user passa a ser `docker compose up -d`
- Transcrição via API (OpenRouter) em vez de WhisperX local — sem necessidade de CUDA
- Multi-user nativo com workflow de aprovação
- Knowledge base centralizada com chat-agente
- Custo: depende de API externa (OpenRouter), mas simplifica drasticamente o produto

---

## ADR-002 — Monorepo: pnpm + Makefile (sem Turbo)

**Data**: 2026-05-15
**Status**: Aceita

### Contexto

Voxen tem 3 apps: 2 Python (chat, worker) + 1 TS (web). Turbo orquestra bem cadeias TS mas não tem suporte first-class pra Python. Avaliou-se Bazel/Pants (overkill) e scripts ad-hoc.

### Decisão

- **pnpm workspaces** pros pacotes TS (apps/web, packages/*)
- **uv** independente em cada app Python (apps/chat, apps/worker)
- **Makefile** na raiz orquestra TODO comando (dev, test, lint, typecheck), chamando bun/pnpm/uv/docker conforme o caso

### Consequências

- Comando único pra qualquer ação: `make <alvo>`
- CI configura cada ecossistema separadamente, mas Makefile vira fonte de verdade
- Sem cache distribuído (Turbo daria isso) — não é crítico pra um projeto desse tamanho

---

## ADR-003 — Agno em vez de Vercel AI SDK no agente

**Data**: 2026-05-15
**Status**: Aceita

### Contexto

Plataforma tem chat com tool calling. Duas opções principais:
- **Vercel AI SDK** (TS, no Bun) — bom streaming + UI hooks
- **Agno** (Python) — multi-agent, memory, RAG nativo

Pra ter "algo robusto desde já" (palavras do owner), Agno é mais completo. Permite expandir pra multi-agent, memory persistente, etc.

### Decisão

Usar **Agno** como agente principal num serviço Python (`apps/chat`). Front consome via SSE custom.

### Consequências

- 1 serviço Python a mais (`apps/chat`)
- Agno não tem stream protocol compatível com AI SDK ([issue #2978](https://github.com/agno-agi/agno/issues/2978), [issue #4766](https://github.com/agno-agi/agno/issues/4766)) — cliente SSE custom no front (ver ADR-009)
- Ganho: framework completo, robustez de longa duração

---

## ADR-004 — Postgres FTS em vez de pgvector (harness/Karpathy)

**Data**: 2026-05-15
**Status**: Aceita

### Contexto

Como o agente acha conteúdo relevante nas transcrições? Dois caminhos:
- **RAG tradicional**: chunks → embeddings → vector store (pgvector) → similarity search
- **Harness/Karpathy**: dar tools (list, read, grep/search) ao agente e deixar ele navegar com a própria inteligência

Karpathy argumenta que embeddings são compressão lossy — pra agentes capazes, ferramentas determinísticas + raciocínio batem RAG vector em muitos casos. É como Claude Code/Cursor operam.

### Decisão

Abordagem **harness**. Agno recebe tools:
- `list_transcripts(workspace_id)`
- `search_transcripts(workspace_id, query)` → Postgres FTS com `ts_headline`
- `read_transcript(id)`, `read_transcript_section(id, from_ts, to_ts)`
- `get_metadata(id)`

Postgres FTS (`tsvector` GIN, dicionário `portuguese`) é o motor de busca. Sem pgvector, sem embeddings, sem reindex.

### Consequências

- **Prós**: 
  - Sem pipeline de embedding (custo zero por chunk)
  - Sem custo de re-indexar quando muda modelo
  - Respostas explicáveis (agente mostra queries que fez)
  - Timestamps clicáveis funcionam naturalmente (textos literais, não chunks)
  - 1 dependência a menos (sem pgvector)
- **Contras**:
  - Pra corpus >10k transcrições longas, pode ficar lento (agente lê texto cru, gasta tokens)
  - Buscas puramente semânticas sem keyword match podem falhar (mitigado por reformulação do agente)
- Trade-off aceitável pro perfil de uso (knowledge base pessoal/equipe pequena)

### Extensão — Query expansion no FTS (spec 047, 2026-06-19)

Pra mitigar o contra "buscas semânticas sem keyword match podem falhar" **sem
introduzir embeddings**, `search_transcripts` passou a expandir a query no nível
do `tsquery` (helper puro `src/fts.py`):

- lexemes unidos por OR (`|`) + prefix match (`:*`) em vez do AND implícito do
  `plainto_tsquery` — frases naturais de poucas palavras passam a casar;
- mapa estático curado de sinônimos PT-BR como alternativas OR;
- `ts_rank` continua ordenando por relevância; fallback pro `plainto_tsquery`
  quando a expansão não produz termos.

Avaliada e **rejeitada** a expansão via LLM (uma chamada por busca): adiciona
latência/custo e quebra o determinismo. A escolhida é **custo zero, latência
zero, 100% determinística e no Postgres** — coerente com esta ADR. Sem pgvector,
sem embeddings, sem reindex.

### Extensão — Harness de recuperação progressiva (spec 074, 2026-07-12)

O harness ganhou um fluxo de recuperação **progressiva** (padrão dos editores de
código com IA), ainda sem embeddings. A lógica compartilhada vive em
`apps/web/src/lib/retrieval.ts` (funções de parsing puras + acessos read-only
escopados por `userId`), consumida tanto pelo agente in-app (`lib/chat/runtime.ts`)
quanto pelo servidor MCP (`routes/mcp.ts`).

Fluxo: **buscar** (FTS `ts_headline`+`ts_rank`) → **ver estrutura** (outline do
`.md` canônico do S3) → **ler só o trecho** (por linhas / seção / intervalo de
tempo) → **expandir contexto** sob demanda → **relacionar** (vizinhança no Brain +
FTS) → **validar citações** (checagem determinística de substring normalizada,
sem LLM). `read_transcript` (documento inteiro) fica como último recurso, caro.

Fonte de estrutura/timestamps é o `.md` canônico no S3 (`Transcript.mdPath`),
não o `plainText` (texto corrido pra FTS). Todas as saídas têm cap de linhas/chars.
Mantém a ADR: determinístico, custo zero de indexação, sem pgvector/embeddings.

---

## ADR-005 — ARQ em vez de BullMQ

**Data**: 2026-05-15
**Status**: Substituída pela implementação de jobs duráveis no Postgres (issue #576)

### Contexto

Workers que rodam extração de mídia + ffmpeg + transcrição precisam consumir fila. BullMQ (Node) é o canônico no ecossistema TS. Mas:
- o extrator usado hoje é Python nativo
- ffmpeg-python e bindings Python são maduros
- Agno também é Python

Manter o worker em TS exigiria subprocess para extração de mídia e perderia integração natural. Manter em Python implica fila Python-friendly.

### Decisão

**ARQ** (async Redis queue pra Python). Redis continua o broker. Worker é Python.

> Nota de implementação (2026-08-02): ARQ nunca chegou a ser usado no runtime.
> A implementação atual persiste a fila em `Job` no Postgres, faz claim com
> `FOR UPDATE SKIP LOCKED` e protege tentativas com lease/heartbeat. Redis
> Pub/Sub é somente wakeup e transporte realtime. Esta nota preserva a decisão
> histórica sem descrever incorretamente a arquitetura em produção.

### Consequências históricas (substituídas)

- Worker e chat compartilham mesmo ecossistema (Python 3.13)
- Sem BullMQ → API web não enfileira diretamente; cria registro `Job` no Postgres e o worker faz poll OU API web fala com Redis usando o protocolo ARQ (decisão a refinar na implementação do worker)
- ARQ é menos maduro que BullMQ mas suficiente pro escopo (poucos jobs concorrentes, simples)

---

## ADR-006 — MinIO/S3-compatible como object storage

**Data**: 2026-05-15
**Status**: Aceita

### Contexto

Transcrições viram `.md` que precisam ser persistidos fora do DB. Opções:
filesystem local, MinIO, Garage S3, S3 externo.

### Decisão

**S3-compatible via `S3_*`**, com **MinIO como padrão** no Compose local/VPS e
no Easypanel. O código mantém fallback `GARAGE_*` para instalações antigas, mas
novos deploys usam MinIO ou outro S3 compatível configurado por env.

### Consequências

- Self-hosted, sem dependência de cloud externa
- API S3-compatible (`boto3`/`aiobotocore` funcionam)
- Paridade entre local, VPS e Easypanel: mesmo bucket e mesmas variáveis `S3_*`
- Em produção com HA real: usar MinIO gerenciado/replicado ou S3 externo

---

## ADR-007 — better-auth com workflow de aprovação

**Data**: 2026-05-15
**Status**: Aceita

### Contexto

Plataforma é multi-user, mas adoção é restrita por design — não é serviço público. Owner quer controlar quem entra.

### Decisão

- **better-auth** (Prisma adapter, email+senha)
- User table tem coluna `status: pending | approved | rejected | disabled`
- Primeiro cadastro (DB vazio) vira admin com `status=approved` automaticamente
- Cadastros subsequentes entram `pending` — admin aprova manualmente em `/admin/usuarios`
- Login com `status != approved` retorna mensagem "aguardando aprovação"

### Consequências

- Owner controla 100% da adoção
- UX: usuário pode cadastrar mas não pode logar até aprovado
- Sem OAuth (Google/GitHub) por enquanto — só email/senha
- SMTP é opcional (notificar admin de novo cadastro) — fase 2

---

## ADR-008 — Master key via `MASTER_KEY` no `.env`

**Data**: 2026-05-15
**Status**: Aceita

### Contexto

Precisamos cifrar secrets em DB (OpenRouter API key, tokens, etc.) com uma
master key. A primeira versão gerava essa chave em volume Docker, mas isso
criava diferença entre Compose e Easypanel e complicava backup/migração.

### Decisão

- Todos os modos documentados usam `MASTER_KEY` no `.env`/Environment.
- Formato único: base64 de 32 bytes (`openssl rand -base64 32`).
- `make dev` cria/completa `.env` local se necessário.
- `MASTER_KEY_PATH` permanece apenas como fallback legado no código.

### Consequências

- Mesmo formato em local, VPS, Proxmox e Easypanel.
- Backup fica simples: Postgres + MinIO + valor de `MASTER_KEY`.
- Se perder `MASTER_KEY`, secrets cifrados em DB ficam inacessíveis.

---

## ADR-009 — Cliente SSE custom no front (sem AI SDK)

**Data**: 2026-05-15
**Status**: Aceita

### Contexto

Agno (back) emite stream em formato próprio. Vercel AI SDK (front) espera protocolo específico de SSE. Integração nativa não existe ([vercel/ai#8098](https://github.com/vercel/ai/issues/8098), [agno-agi/agno#2978](https://github.com/agno-agi/agno/issues/2978), [agno-agi/agno#4766](https://github.com/agno-agi/agno/issues/4766)).

Caminhos:
- (a) cliente SSE custom no React (~50 linhas)
- (b) bridge no Bun traduzindo Agno → AI SDK protocol
- (c) trocar Agno por AI SDK (vai contra ADR-003)

### Decisão

**(a) — cliente SSE custom no React.** Sem AI SDK. Hook próprio usa `EventSource` ou `fetch` + `ReadableStream` (pra mandar headers de auth).

### Consequências

- 1 dependência a menos no front
- Mais código pra manter (~50 linhas)
- Sem útil-mas-açúcar do `useChat` — implementamos só o que precisamos
- Quando/se Agno suportar AI SDK protocol oficialmente, migrar é simples

---

## ADR-010 — Mapa do Brain 2D-first com slice (não dump 3D global)

**Data**: 2026-07-19
**Status**: Aceita

### Contexto

O `/grafo` abria em 3D com snapshot quase completo e arestas de co-ocorrência
fracas. O mercado OSS de second-brain (Obsidian, Sigma, exploradores leves)
prioriza mapa **rápido**, 2D WebGL e recortes (local/overview), não simulação
3D do universo inteiro.

### Decisão

1. **Default 2D (Sigma)**; 3D (Reagraph) só sob demanda.
2. **`view=map` por padrão** no `GET /api/graph`: ≤180 nós / ≤400 arestas,
   conceitos só com grau ≥2, arestas fracas omitidas.
3. **`view=full`** e **`focus`+`hops`** para dump e ego-network.
4. Indexador Brain com limiar mais alto em `RELATED_TO` (shared-concepts /
   semantic-profile).

### Consequências

- Tempo até interativo cai (sem bundle 3D no path crítico; payload menor).
- Mapas densos com n-grama barulhento somem da UI padrão.
- Full view permanece para diagnóstico e bases pequenas.
- Spec: `.specs/103-graph-fast-map.md`.

---

## ADR-011 — LangExtract: adotar o padrão, não a lib (por agora)

**Data**: 2026-07-19
**Status**: Aceita

### Contexto

[LangExtract](https://github.com/google/langextract) (Google, **Apache-2.0**)
extrai informação estruturada de texto com LLM, **source grounding** (offsets
no texto) e few-shot. É o estado da arte open-source para “compile na
ingestão” de entidades/claims.

### Alternativas

| Opção | Prós | Contras |
|-------|------|---------|
| (a) Dependência `langextract` no worker | Grounding maduro, viz HTML | Stack Gemini/Ollama-centric; Voxen é OpenRouter-first; deps extras; path de auth paralelo |
| (b) Reimplementar o **padrão** (schema + few-shot + excerpt obrigatório) via OpenRouter | Cabe no ADR-004/harness; 1 chave; licença limpa | Mais código nosso |
| (c) Ignorar grounding | Rápido | Arestas/claims sem citação — piora o Brain |

### Decisão

**(b) — adotar o padrão LangExtract sem a biblioteca neste ciclo.**

- Extrações futuras de conceitos/claims **devem** exigir trecho literal
  (`excerpt`) no texto-fonte (grounding).
- Provider único: OpenRouter (settings cifrados), não chave Gemini à parte.
- Reavaliar `langextract` se surgir provider OpenRouter de primeira classe
  estável e o custo de manter o extrator próprio passar do custo da lib.

### Consequências

- Não aumenta superfície de supply-chain no worker agora.
- Spec 103 não inclui compile LLM; fica backlog P1 (concept/claim grounded).
- Apache-2.0 seria aceitável se (b) deixar de ser suficiente.
- **2026-07-19:** implementado em spec 104 — extrator grounded OpenRouter no worker
  (`brain_extract.py`) sem a lib LangExtract.

---

## ADR-012 — Compile grounded + clusters + embeddings opt-in

**Data**: 2026-07-19
**Status**: Aceita

### Decisão

1. **Compile na ingestão**: após tags, extrair entidades/claims com excerpt
   literal (grounding). Materializar `ENTITY`/`CLAIM` + `MENTIONS` method
   `llm-grounded`. Best-effort (não falha o job).
2. **Clusters**: no map view, comunidades com ≥3 nós ganham hub virtual
   `type=cluster` e arestas `part_of`/`community`.
3. **Embeddings opt-in**: setting `embeddings_enabled`; vetor no
   `BrainNode.metadata.embedding` (sem pgvector). Busca FTS default; com flag,
   reordenação híbrida dos hits FTS.

### Consequências

- Arestas com citação real; grafo menos “palavra solta”.
- Sem migração de schema / sem Neo4j.
- Embeddings desligados por default — zero custo extra em deploys mínimos.

---
