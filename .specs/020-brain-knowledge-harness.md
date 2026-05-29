# Spec 020 — Voxen Brain: grafo de conhecimento, lifecycle e harness MCP

## Contexto

A pagina `/grafo` atual e uma visualizacao Obsidian-like simples: transcricoes,
notas e pastas aparecem como nos, mas as arestas reais ficam limitadas a
`[[wikilinks]]` entre notas e hierarquia de pastas. Isso nao cria um "cerebro"
operacional para a IA, nem resolve recuperacao multi-hop, citacoes,
temporalidade ou remocao segura de conhecimento derivado.

O Voxen Brain e a camada de conhecimento interna da plataforma. Ele deve servir
tres superficies:

- UI: mapa visual navegavel da biblioteca.
- Chat: ferramentas deterministicas para a IA pesquisar, expandir contexto,
  explicar conexoes e citar fontes.
- MCP: API de memoria/conhecimento para automacoes e clientes externos.

Inspiracoes usadas como referencia de produto/arquitetura:

- Obsidian/Logseq/Anytype para UX de notas, backlinks e mapa visual.
- Microsoft GraphRAG para comunidades, resumos globais e busca local/global.
- Graphiti/Zep para memoria temporal e atualizacao incremental.
- Cognee/MCP memory server para formato de ferramentas de entidades, relacoes
  e observacoes.
- HippoRAG/LightRAG para recuperacao multi-hop e combinacao de sinais lexicais,
  grafo e similaridade.

## Decisao arquitetural

O Brain deve ser Postgres-first e self-hosted. Nao introduzir Neo4j, FalkorDB,
servico externo obrigatorio ou dependencia pesada no MVP. A modelagem deve ficar
no schema Prisma/Postgres, com FTS e indices relacionais; embeddings/pgvector
podem entrar depois como sinal opcional, nao como fundamento da arquitetura.

O Brain nao substitui `Transcript`, `Note`, `Job` ou storage S3. Ele materializa
conhecimento derivado e relacoes navegaveis com proveniencia forte.

## Requisitos

### Ubiquitous

- The system shall represent library content as brain nodes scoped by `userId`.
- The system shall keep every derived node, edge, claim, observation, chunk
  summary and cluster traceable to one or more source records.
- The system shall store source provenance with `sourceType`, `sourceId`,
  optional `chunkId`, optional timestamp range and evidence excerpt.
- The system shall expose deterministic Brain tools to chat and MCP instead of
  requiring the model to infer directly from raw UI data.
- The system shall keep manual user structure first-class: folders, manual
  relations, wiki-links and backlinks must not be overwritten by automated
  extraction.
- The system shall avoid mandatory embedding infrastructure in the MVP.

### Event-driven

- When a transcript job finishes successfully, the system shall enqueue Brain
  indexing for that transcript.
- When a note is created or updated, the system shall enqueue Brain indexing for
  that note.
- When a folder assignment changes, the system shall update folder edges and
  invalidate graph caches.
- When the user creates or removes a manual relation, the system shall update the
  graph and expose the change to chat/MCP.
- When a source content item is deleted, archived or restored, the system shall
  apply the corresponding lifecycle policy to all derived Brain records.

### State-driven

- If a source is active, Brain search/chat/MCP may use its derived records.
- If a source is archived, Brain search may include it only when the caller opts
  into archived content.
- If a source is in trash, Brain search/chat/MCP must hide it by default.
- If a source is hard-deleted, Brain must purge derived records and storage
  references that are exclusively derived from that source.
- If an entity is shared by multiple sources, deleting one source must remove only
  the orphaned observations/edges and preserve the shared entity while other
  active sources still support it.
- If a cluster summary loses one or more source members, it must be marked stale
  and regenerated before being used as authoritative context.

### Optional

- The system may use embeddings/pgvector as an additional retrieval signal after
  the lexical/graph MVP is stable.
- The system may support external graph databases later if real query patterns
  prove Postgres insufficient.
- The system may generate wiki pages from clusters once source citations and
  invalidation are reliable.

### Unwanted

- The system shall not present LLM-extracted facts as truth without citation,
  confidence and extraction method.
- The system shall not keep deleted content reachable through chat/MCP because a
  stale Brain record survived.
- The system shall not make folders move S3 objects in the MVP; foldering is
  metadata and navigation.
- The system shall not depend on public proxy lists, account cookies or external
  SaaS memory services to make Brain work.

## Modelo conceitual

### Content lifecycle

Content records need lifecycle state independent of Brain:

- `active`: visible and usable.
- `archived`: hidden from default library views, available through explicit
  filters.
- `trash`: pending deletion, hidden from chat/MCP and default search.
- `deleted`: hard purge completed.

Hard delete must purge:

- source DB record when allowed by product policy;
- S3/MinIO object for markdown/media when applicable;
- chunks and FTS references;
- Brain nodes/edges/claims/observations derived only from that source;
- stale graph/search caches.

### Brain source

Every Brain-derived record must be attributable to a source:

- `TRANSCRIPT`
- `NOTE`
- `FOLDER`
- `JOB`
- `CHAT`
- `MANUAL`

Manual user-created relations count as source `MANUAL` and should survive
content reindexing unless one endpoint node is hard-deleted.

### Brain nodes

Initial node types:

- `CONTENT`: transcript, note, document, uploaded media, web page.
- `FOLDER`: user organization node.
- `ENTITY`: person, organization, product, project, place, concept.
- `TOPIC`: recurring theme/subject.
- `CLAIM`: factual statement extracted from content.
- `EVENT`: dated or temporal occurrence.
- `CLUSTER`: materialized community/topic group.

### Brain edges

Initial edge kinds:

- `BELONGS_TO`: content belongs to folder/collection.
- `LINKS_TO`: explicit wiki-link, mention or manual link.
- `MENTIONS`: content mentions entity/topic.
- `SUPPORTS`: source supports claim.
- `CONTRADICTS`: source conflicts with claim or another claim.
- `SAME_AS`: entity deduplication.
- `PART_OF`: hierarchy between topic/entity/folder/cluster.
- `RELATED_TO`: weak automated relation with confidence.
- `NEXT_TO`: temporal or sequence relation.

All automated edges need `confidence`, `method`, `createdAt`, `updatedAt` and
source evidence. Manual edges need `createdBy=userId`.

### Folders

Folders should organize both notes and transcripts/content. The MVP can either:

1. Introduce a shared `LibraryFolder` model and migrate note folders later.
2. Reuse `Note(kind=FOLDER)` temporarily and add nullable folder relation to
   transcripts.

Preferred direction: a shared folder model for library organization, with a
compatibility/migration path for existing note folders. Foldering is metadata,
not physical movement in S3.

## Ferramentas para chat e MCP

The Brain layer should expose tools with bounded, typed responses:

- `brain.search(query, filters, limit)`: hybrid FTS + graph search.
- `brain.neighbors(nodeId, depth, filters)`: local expansion.
- `brain.path(fromNodeId, toNodeId)`: explain connection path.
- `brain.sources(nodeId | claimId)`: return citations/evidence.
- `brain.timeline(query | entityId)`: temporal view.
- `brain.summarize_cluster(clusterId)`: cluster summary with citations.
- `brain.save_relation(from, to, kind, note)`: manual relation.
- `brain.move_to_folder(contentId, folderId)`: organization command.

For transcription requests from chat, the tool behavior should be:

- create/reuse a job;
- wait for completion for short jobs or explicit "transcreva e responda"
  requests up to a configured timeout;
- stream progress/heartbeats while waiting;
- return transcript/summary context to the model when complete;
- fall back to background mode with job link when timeout or long-running media
  makes synchronous waiting impractical.

## UI

The `/grafo` page should evolve into `/cerebro` or a richer Brain page:

- full-screen graph area with stable controls;
- cluster/community view;
- local expansion around selected node;
- side inspector with source preview, citations and actions;
- filters for content type, source, folder, method, confidence and lifecycle;
- path/explain mode between two nodes;
- stale/reindex indicators;
- consistent preview cards shared with library/search/chat mentions.

The existing `/grafo` route may remain as redirect or compatibility entrypoint.

## PR breakdown

### PR 1 — Spec and technical contract

- Create this spec.
- No runtime behavior changes.

### PR 2 — Content folders and lifecycle foundation

- Add schema fields/models for shared folders and lifecycle state.
- Add migrations.
- Add API routes for folder CRUD and content folder assignment.
- Update transcript list/detail UI with folder controls.
- Ensure default queries hide trashed content.

### PR 3 — Safe delete/archive/trash

- Add archive/trash/restore/hard-delete endpoints.
- Purge S3 object and derived records on hard delete.
- Add cache invalidation hooks.
- Add tests for user scoping and orphan handling.

### PR 4 — Brain MVP schema and indexer

- Add Brain node/edge/source tables.
- Index notes, transcripts, wiki-links, folders and basic FTS relations.
- Reindex on transcript completion and note/folder changes.
- Keep every relation source-cited.

### PR 5 — Brain tools for chat/MCP

- Add server-side Brain tool endpoints.
- Wire chat service tools to search/expand/source/path.
- Add synchronous transcription wait mode with timeout fallback.
- Keep SSE heartbeats during long tool execution.

### PR 6 — Brain UI and card consistency

- Replace simple graph payload with Brain graph payload.
- Add side inspector, node sizing by degree, relation-aware styling and source
  navigation.
- Backfill legacy source nodes on graph load/refresh when Brain records are
  missing.
- Normalize library preview card dimensions and media aspect-ratio across
  content sources.
- Defer shared preview-card extraction until another surface needs the exact
  component contract; keep this PR focused on behavior and visual consistency.
- Visual verification should happen against the Easypanel deployment after the
  release, because the owner explicitly asked not to start the local app.

### PR 7 — Release dev to main and Easypanel deploy

- Open release PR from `dev` to `main`.
- Wait for main checks.
- Deploy on Easypanel after `main` is green.
- Validate logs and smoke endpoints after deploy.

## Critérios de aceite globais

- [ ] Deleting a transcript removes or hides every Brain-derived record from
      chat/MCP immediately.
- [ ] Hard delete purges storage and orphaned derived records.
- [ ] Brain tools always return citations for extracted claims/relations.
- [ ] `/grafo` or `/cerebro` shows meaningful clusters/connections for
      transcripts, not only isolated nodes.
- [ ] Chat can wait for transcription completion when practical and answer with
      the resulting content.
- [ ] Content previews use consistent dimensions and metadata across library,
      graph and mentions.
- [ ] Transcripts/content can be organized in folders without moving S3 files.
- [ ] CI, typecheck, tests and Docker build are green before merge.

## Fora de escopo inicial

- Mandatory vector database.
- Full bidirectional sync with Obsidian vaults.
- Collaborative realtime graph editing.
- Public SaaS/multi-tenant billing features.
- Guaranteed YouTube extraction under every VPS/IP block scenario.
