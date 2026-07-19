# Spec 104 — Compile grounded, clusters e embeddings opt-in

## Contexto

Após o mapa rápido (spec 103), o Brain ainda depende de n-gramas e co-ocorrência.
O mercado OSS (LangExtract, second-brain compile-upfront) usa extração estruturada
**com trecho literal** na ingestão. Clusters dão nível meso ao grafo. Embeddings
ficam **opt-in** (ADR-004), nunca obrigatórios.

## Requisitos

### Ubiquitous

- The system shall, após tags na ingestão bem-sucedida, tentar extrair entidades e
  claims estruturados com **excerpt** literal do texto-fonte (grounding).
- The system shall descartar extrações cujo excerpt não exista no texto-fonte
  (case-insensitive, whitespace normalizado).
- The system shall materializar entidades/claims no Brain com method `llm-grounded`
  e arestas MENTIONS com excerpt em BrainSource.
- The system shall expor comunidades no snapshot do grafo com id, size, label e
  nodeIds (já parcial) e incluir **nós virtuais de cluster** no map view quando
  a comunidade tiver ≥3 membros.
- The system shall manter FTS como caminho default de busca; embeddings só quando
  a setting `embeddings_enabled` for true.

### Event-driven

- When a extração grounded falhar (rede/modelo), the system shall logar e seguir
  sem falhar o job (best-effort).
- When embeddings estiverem habilitados e houver chave OpenRouter, the system shall
  gerar e persistir um vetor no metadata do nó CONTENT após indexar o Brain.
- When `search_transcripts` rodar com embeddings habilitados e vetores disponíveis,
  the system shall fundir rank FTS com similaridade coseno (híbrido).

### Unwanted

- If embeddings estiverem desabilitados, then the system shall não chamar API de
  embedding nem exigir pgvector.
- If o excerpt grounded for vazio ou não groundable, then the system shall não
  criar nó/aresta para esse item.

## Critérios de Aceite

- [ ] Worker tem extrator grounded testável (parse + grounding).
- [ ] Pipeline chama extrator best-effort após tags.
- [ ] Map view pode mostrar clusters (tipo cluster).
- [ ] Setting embeddings_enabled controla geração/uso.
- [ ] Testes unitários cobrem grounding, clusters e fusão híbrida.

## Fora de Escopo

- Dependência `langextract` no PyPI.
- Neo4j / GraphRAG Microsoft completo.
- Reindex bulk obrigatório de todo o acervo legado na migração.
