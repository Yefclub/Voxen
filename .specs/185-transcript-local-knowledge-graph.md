# Spec 185 — Grafo local de conhecimento da transcrição

## Contexto

A página de uma transcrição apresenta o conteúdo, o resumo, o fluxo visual e as
anotações, mas não expõe os conceitos e relações materializados no Brain. O
usuário precisa compreender tanto o conhecimento extraído daquela fonte quanto
as conexões dela com o restante de sua base sem abandonar o contexto da leitura.

Esta spec foi aprovada como a primeira entrega da ordem de evolução do Guia
pessoal e do grafo de conhecimento. O Brain existente permanece como fonte
canônica; a página apresenta apenas projeções locais e fundamentadas.

## Glossário

- **Grafo local**: subgrafo centrado na transcrição atual.
- **Conhecimento interno**: tópicos, entidades, afirmações, eventos e relações
  com evidência na transcrição atual.
- **Conexões da base**: vizinhos do conteúdo no Brain que podem ter origem em
  outras transcrições, notas, pastas ou enriquecimentos.
- **Evidência navegável**: origem com trecho e, quando disponível, linhas ou
  timestamps que levam ao ponto correspondente da transcrição.

## Requisitos

### Ubiquitous

- The system shall derive both local graph views from the existing Brain records without duplicating graph state.
- The system shall scope every transcript, node, edge, compilation and evidence query to the authenticated user.
- The system shall expose the graph as an accessible node list in addition to the visual canvas.
- The system shall identify extracted, inferred and ambiguous relations in the local graph response.

### Event-driven

- When the transcript detail page loads an active or archived transcript, the system shall load the graph view for knowledge evidenced by that transcript.
- When the user selects the base-connections view, the system shall load a bounded ego network centered on the transcript content node.
- When the user selects a node, the system shall display its type, description, relation confidence and available evidence.
- When the user activates evidence with lines or timestamps, the system shall navigate to the corresponding passage in the current transcript.
- When the user opens the global graph, the system shall preserve the transcript content node as the initial focus.

### State-driven

- While semantic compilation is pending, running or retrying, the system shall identify the graph as indexing and show durable progress.
- While semantic compilation is partial, the system shall keep available nodes visible and identify that coverage is incomplete.
- While semantic compilation has failed, the system shall keep previously materialized nodes visible and identify the failed state.
- While no content node exists, the system shall show a non-blocking not-indexed state instead of an empty unexplained canvas.

### Optional

- Where evidence contains timestamps, the system shall generate a timestamp anchor.
- Where evidence contains line numbers but no timestamps, the system shall generate a line anchor.
- Where a transcript has no durable semantic compilation but has a legacy Brain content node, the system shall present the available graph as ready.

### Unwanted behavior

- If the transcript does not belong to the authenticated user, then the system shall return not found without revealing graph existence.
- If an evidence record points to an unavailable node or edge, then the system shall omit the dangling reference without failing the complete response.
- If the requested view or hop count is invalid, then the system shall use bounded defaults.

## Critérios de Aceite

- [ ] A API oferece os recortes `content` e `connections` para uma transcrição.
- [ ] O recorte `content` contém somente o foco e conhecimento sustentado pela fonte atual.
- [ ] O recorte `connections` é limitado a no máximo dois saltos e aos limites defensivos do Brain.
- [ ] A resposta informa foco, recorte, truncamento, compilação e estado visual.
- [ ] Evidências retornam trecho, linhas e timestamps sem expor dados de outro usuário.
- [ ] A página de detalhe possui canvas 2D, lista acessível, seletor de recorte e inspetor.
- [ ] Evidências navegam para a passagem da transcrição.
- [ ] A abertura do grafo global preserva o foco.
- [ ] Estados de carregamento, não indexado, parcial e falho possuem mensagens em PT-BR e inglês.
- [ ] Testes cobrem isolamento, seleção dos recortes, estado da compilação e âncoras.

## Fora de Escopo

- Criar ou reprocessar conhecimento diretamente pelo canvas.
- Editar entidades ou relações.
- Renderização 3D na página da transcrição.
- Alterar o algoritmo global de comunidades ou centralidade.
- Criar um perfil de interesses pessoais.

## Riscos / Decisões pendentes

- Transcrições antigas podem possuir um nó de conteúdo sem compilação semântica
  durável; esse estado é tratado como grafo legado disponível.
- Evidências heurísticas podem não possuir linhas ou timestamps; continuam
  identificadas como inferidas e não recebem navegação artificial.
