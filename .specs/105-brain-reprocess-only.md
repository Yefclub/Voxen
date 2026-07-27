# Spec 105 — Reprocessar só o cérebro

## Contexto

O usuário precisa reconstruir o mapa do Brain sem re-rodar a ingestão (tags,
resumo, extract LLM, embeddings) — o que gastaria créditos e poderia
sobrescrever trabalho já feito nos conteúdos. Já existe `force=1` no grafo; a
UX e a preservação de arestas `llm-grounded` precisam ficar explícitas.

## Requisitos

### Ubiquitous

- The system shall expor na UI do `/grafo` a ação **Reprocessar cérebro** com
  confirmação que deixa claro o que é e o que não é refeito.
- The system shall, no reprocesso do Brain, reconstruir nós de conteúdo/pastas/
  notas e arestas heurísticas (`keyword`, `shared-concepts`, `semantic-profile`,
  `timeline-adjacent`) a partir de dados **já persistidos**.
- The system shall **não** regenerar tags, resumos, títulos nem embeddings
  nessa ação.
- The system shall **não** chamar o extrator grounded LLM nessa ação.

### Event-driven

- When o usuário confirmar o reprocesso, the system shall disparar o passe
  completo do Brain (`force`) em background e atualizar o snapshot quando pronto.

### Unwanted

- If existirem arestas `llm-grounded` ou `manual`, then the system shall
  preservá-las no reprocesso (não apagar evidência cara / manual).
- If o reprocesso falhar, then the system shall manter o snapshot anterior
  utilizável e permitir nova tentativa.

## Critérios de Aceite

- [ ] Botão com confirmação e copy em PT/EN.
- [ ] Reprocesso não toca `Tag` / `summaryMd` / `plainText`.
- [ ] Evidência `llm-grounded` não é removida no reindex heurístico.
- [ ] Testes cobrem a lista de métodos refreshable vs preservados.

## Fora de Escopo

- Batch de extract LLM / embeddings em acervo legado.
- Admin-only; a ação é do próprio workspace.
