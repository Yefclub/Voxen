# 069 — Pastas de biblioteca classificadas por IA

## Contexto

A biblioteca já tem pastas manuais (`LibraryFolder` + `Transcript.folderId`) e
filtros na UI de `/transcricoes`. O worker nunca atribuía pasta. Pedido: após
transcrever/indexar, a IA classifica o conteúdo em **uma** pasta (1:1), reusando
pastas existentes ou criando uma nova (ex.: "Anime"), sem confirmação do user.

## Glossário

- **pasta**: `LibraryFolder` do usuário; base das abas/filtros da biblioteca.
- **NONE**: resposta da IA indicando que não deve atribuir pasta.

## Requisitos (EARS)

### Ubiquitous

- **R1** — The system shall classificar cada conteúdo novo em no máximo uma pasta
  por usuário (relação 1:1 Transcript → folderId).
- **R2** — The system shall preferir reutilizar pastas existentes do mesmo
  workspace quando o nome bater (case-insensitive ou similaridade simples).

### Event-driven

- **R3** — When um job conclui a persistência do Transcript com texto suficiente,
  the system shall chamar o classificador (modelo de chat padrão + OpenRouter).
- **R4** — When a IA devolver um nome de pasta válido, the system shall garantir a
  existência da pasta (create se necessário) e gravar `folderId` no Transcript.
- **R5** — When a IA responder `NONE` (ou equivalente), the system shall deixar
  `folderId` nulo.
- **R6** — When a classificação falhar (rede, auth, modelo ausente), the system
  shall não falhar o job e deixar `folderId` nulo.

### Unwanted

- **R7** — If o texto for muito curto e o título for vazio, then the system shall
  pular a classificação.
- **R8** — If o nome gerado tiver menos de 2 caracteres após sanitização, then
  the system shall tratar como sem pasta.

## Critérios de Aceite

- [ ] Vídeo, upload, X e scrape web tentam classificação após persistir
- [ ] Pasta existente é reutilizada (não duplica "anime"/"Anime")
- [ ] Pasta nova é criada no root do user
- [ ] Falha best-effort não marca job FAILED
- [ ] CostEvent com `source: folder_classification` quando a call ocorre
- [ ] Testes unitários de decisão e payload

## Fora de Escopo

- Tags multi-valor (N:N)
- Hierarquia automática de pastas (parentId)
- Merge/renome de pastas duplicadas legadas
- Backfill de conteúdos antigos
- Confirmação HITL do user

## Riscos

- Proliferação de pastas se a IA inventar sinônimos — mitigado por lista de
  existentes no prompt + match case-insensitive
- +1 call LLM barata por job
