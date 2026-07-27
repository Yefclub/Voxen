# Spec 074 — Harness de recuperação progressiva do agente

## Status

Aprovado pelo owner (2026-07-12).

## Contexto

O agente in-app (Vox, `apps/web/src/lib/chat/runtime.ts`) tinha ferramentas fracas:
`search_transcripts` usava `contains` do Prisma (ILIKE, sem ranking nem highlight)
e `read_transcript` despejava até 20k chars de texto puro por chamada. O servidor
MCP (`apps/web/src/routes/mcp.ts`) já tinha FTS e leitura completa, mas nenhum dos
dois oferecia recuperação **progressiva** — o padrão de editores de código com IA
(buscar → ver estrutura → ler só o trecho → expandir → validar).

Esta spec evolui ambos para um fluxo de recuperação progressiva determinística,
sem embeddings (ADR-004), com a lógica compartilhada em um módulo novo
`apps/web/src/lib/retrieval.ts` (DRY entre runtime.ts e mcp.ts). As funções de
parsing são puras (recebem o texto do `.md`), testáveis sem S3.

Fonte de estrutura/timestamps: o `.md` canônico no S3/MinIO (`Transcript.mdPath`),
não o `plainText` do Postgres (que é só texto corrido pra FTS). Formato em
`docs/TRANSCRIPT-FORMAT.md`.

Referências: ADR-004 (`docs/DECISIONS.md`), spec 070 (remoção do chat Python,
manutenção do MCP), `docs/TRANSCRIPT-FORMAT.md`.

## Glossário

- **`.md` canônico**: arquivo Markdown da transcrição no S3 (frontmatter + headings
  `##` + linhas `[hh:mm:ss](url?t=SEG) texto`).
- **Outline**: estrutura compacta do `.md` — lista de seções (heading, linha
  inicial, nº de linhas, timestamp inicial) + total de linhas.
- **Context Pack**: conjunto mínimo de trechos recuperados que sustenta a resposta.
- **Claim**: afirmação factual com referência (transcriptId + trecho + citação) a
  ser verificada deterministicamente.

## Requisitos

### Ubiquitous

- The system shall expor a lógica de recuperação em um módulo compartilhado
  (`lib/retrieval.ts`) usado pelo agente in-app e pelo servidor MCP.
- The system shall implementar as funções de parsing do `.md` como funções puras
  que recebem o texto do `.md` como argumento (sem acesso a DB/S3).
- The system shall escopar toda leitura de dados por `userId` e restringir a
  transcrições com `status = ACTIVE` (isolamento de workspace).
- The system shall manter todas as ferramentas de recuperação read-only,
  determinísticas e sem efeito colateral.
- The system shall limitar toda saída de leitura (cap de linhas e de caracteres),
  nunca devolvendo o documento inteiro sem intenção explícita.
- The system shall instruir o agente (instructions do runtime e VOXEN_INSTRUCTIONS
  do MCP) a seguir o fluxo progressivo de dez passos.
- The system shall instruir o agente in-app a **nunca** expor nomes de ferramentas,
  parâmetros ou sintaxe de API na resposta final ao usuário; próximos passos em
  linguagem natural de produto (as tools permanecem internas).

### Event-driven

- When o agente busca conteúdo, the system shall usar Postgres FTS
  (`ts_headline` + `ts_rank`) e retornar id, título, snippet destacado e rank —
  nunca o texto completo.
- When o agente pede o outline de uma transcrição, the system shall retornar as
  seções (heading, timestamp inicial em hh:mm:ss + segundos, linha inicial, nº de
  linhas) e o total de linhas, sem conteúdo pesado.
- When o agente lê por intervalo de linhas, the system shall retornar as linhas
  [from, to] (1-indexed, inclusivo) com cap de 200 linhas.
- When o agente lê por seção (por heading ou índice do outline), the system shall
  retornar as linhas daquela seção.
- When o agente lê por intervalo de tempo, the system shall retornar as linhas
  cujo timestamp `[hh:mm:ss]` cai em [fromSec, toSec].
- When o agente expande contexto a partir de uma âncora (linha ou timestamp), the
  system shall retornar uma janela de N linhas antes/depois.
- When o agente pede documentos relacionados (por transcriptId e/ou query), the
  system shall retornar itens (id, título, tipo, motivo) via vizinhança no Brain
  e FTS por título/tópico.
- When o agente verifica citações, the system shall, para cada claim, re-ler o
  trecho indicado do `.md` e checar deterministicamente (sem LLM, comparação
  normalizada sem acentos/caixa/espaços) se a `quote` está presente, retornando
  `supported` e `foundText` por claim.

### State-driven

- While o `.md` não pode ser lido do S3, the system shall usar o `plainText` do
  Postgres como fallback para a leitura da transcrição.

### Optional

- Where houver arestas no Brain conectando a transcrição de origem a outras
  transcrições/notas, the system shall incluí-las nos relacionados com o motivo
  da conexão.

### Unwanted behavior

- If a transcrição não existe ou não pertence ao usuário, then the system shall
  retornar erro sem vazar conteúdo de outro workspace.
- If o intervalo pedido excede o cap, then the system shall truncar e sinalizar
  `truncated = true`.
- If a `quote` for vazia após normalização, then the system shall retornar
  `supported = false`.
- If bounds fora do range forem informados, then the system shall fazer clamp aos
  limites do documento.

## Critérios de Aceite

- [x] `lib/retrieval.ts` criado com funções puras (parseOutline, readLinesFromMd,
      readSectionFromMd, readTimespanFromMd, expandContextFromMd,
      verifyClaimAgainstMd, parseLineTimestamp, secondsToHms, normalizeForMatch) e
      funções de acesso (loadTranscriptMd, ftsSearchTranscripts, findRelated).
- [x] runtime.ts: `search_transcripts` migrado para FTS; novas tools
      outline_transcript, read_lines, read_section, read_timespan, expand_context,
      related, verify_citations; `read_transcript` mantido como último recurso.
- [x] mcp.ts: novas tools voxen_outline, voxen_read_lines, voxen_read_section,
      voxen_read_timespan, voxen_expand_context, voxen_related,
      voxen_verify_citations; voxen_search_transcripts usando o helper compartilhado.
- [x] instructions do agente in-app e VOXEN_INSTRUCTIONS do MCP com o fluxo de dez
      passos.
- [x] Testes unitários das funções puras (parsing, bounds, caps, timespan,
      expand, verify) + teste leve de buildTools.
- [x] Lint, typecheck e testes TS passam (sem Docker/Playwright nesta entrega).

## Fora de Escopo

- Embeddings / RAG vetorial (contraria ADR-004).
- Dependência de tabela `Chunk` (está vazia).
- Tags nos relacionados — chegam em PR paralela; deixado TODO em `findRelated`.
- Populamento/geração do `.md` (worker) — inalterado.

## Riscos / Decisões

- O parsing assume o formato de `docs/TRANSCRIPT-FORMAT.md` (timestamps
  `[hh:mm:ss]` no início da linha, headings `#`..`######`). `.md` legado sem esse
  formato degrada para leitura por linhas sem timestamps/seções — aceitável.
- `verify_citations` é intencionalmente sintático (substring normalizado), não
  semântico: é uma checagem determinística de presença, não de veracidade.
- Orçamento de passos do agente in-app elevado de 5 para 12 para acomodar o fluxo
  progressivo (mais chamadas curtas em vez de um read gigante).
