# 075 — Tags de conteúdo geradas por IA (com pasta automática)

## Contexto

A biblioteca já tem pastas (`LibraryFolder` + `Transcript.folderId`, relação 1:1) e
classificação de pasta por IA (spec 069). Pasta é um vínculo **único** por
conteúdo — não expressa que um conteúdo pertence a vários temas. Pedido do owner:
a IA deve gerar **tags** (many-to-many) a partir do conteúdo + resumo, para
organizar a biblioteca e turbinar ligação/busca. Um conteúdo pode ter várias tags
(ex.: "Anime", "Review", "Estúdio Ghibli").

Decisão do owner: **cada tag também vira uma pasta** (`LibraryFolder` de mesmo
nome, auto-criada). Assim tag e pasta convivem: a pasta continua sendo o vínculo
único de navegação/Brain; a tag é o vínculo múltiplo de organização/busca.

## Glossário

- **tag**: `Tag` do usuário (nome + slug normalizado). N:N com `Transcript` via
  `TranscriptTag`. Cada tag referencia 1 `LibraryFolder` (auto).
- **slug**: forma normalizada do nome (minúsculas, sem acento, `a-z0-9-`). É a
  chave de deduplicação por usuário (UNIQUE `userId, slug`).
- **conteúdo sem tag**: `Transcript` ACTIVE sem nenhum `TranscriptTag`.

## Decisões de modelagem

- **Onde fica o ponteiro tag↔pasta**: `Tag.folderId` (opcional, `@unique`) →
  `LibraryFolder`. Justificativa: mantém `LibraryFolder` intacto (pastas manuais
  e as da spec 069 não mudam), e a Tag "aponta" para sua pasta auto. `onDelete:
  SetNull` na pasta (limpar pastas não apaga tags). Deletar a tag não apaga a
  pasta (a pasta é navegação legítima).
- **`Transcript.folderId` continua único (1:1)**. Como um conteúdo pode ter
  várias tags mas só uma pasta, a regra é:
  - **R-FOLDER** — When a IA atribui tags a um conteúdo, the system shall, se o
    `Transcript.folderId` estiver **vazio**, defini-lo com a pasta da **primeira**
    tag (mais relevante). Se já houver `folderId`, **não mover** — as demais tags
    ficam só como tags.
- **Reuso obrigatório**: a IA recebe a lista de tags existentes e deve reutilizar
  quando fizer sentido (não criar quase-duplicatas). Dedup final é determinístico
  por slug.

## Requisitos (EARS)

### Ubiquitous

- **R1** — The system shall permitir múltiplas tags por conteúdo (N:N via
  `TranscriptTag`), escopadas por `userId`.
- **R2** — The system shall deduplicar tags por `slug` dentro do workspace
  (UNIQUE `userId, slug`), reutilizando a tag existente em vez de criar duplicata.
- **R3** — The system shall garantir, para cada tag criada/atribuída, uma
  `LibraryFolder` de mesmo nome no root do usuário (idempotente por nome
  case-insensitive), e vinculá-la em `Tag.folderId`.

### Event-driven

- **R4** — When o usuário aciona "Gerar tags" (em um conteúdo ou em lote), the
  system shall chamar o modelo de chat padrão (OpenRouter) passando título +
  resumo/texto + a lista de tags existentes, e receber de volta poucas tags
  (cap 5) — reutilizadas e/ou novas.
- **R5** — When o modelo devolver tags válidas, the system shall criar/reutilizar
  cada `Tag` (por slug), garantir a `LibraryFolder` (R3), ligar via
  `TranscriptTag` e aplicar **R-FOLDER** (setar `folderId` só se vazio).
- **R6** — When a busca da biblioteca recebe uma query, the system shall casar
  também por nome/slug de tag do conteúdo, além do FTS de título/texto.
- **R7** — When a geração falhar (rede, auth, modelo ausente), the system shall
  não derrubar o request/lote e seguir best-effort (conteúdo fica sem tag).

### Unwanted

- **R8** — If o texto e o título forem curtos demais, then the system shall pular
  a geração (skip).
- **R9** — If o modelo devolver ruído/frases/raciocínio, then the system shall
  descartar (mesmo saneamento do classificador de pasta).
- **R10** — If o conteúdo já tem tags, then a operação em **lote** shall pulá-lo
  (só processa "conteúdo sem tag"); a operação **individual** re-gera e faz merge
  (não duplica por slug).

## Critérios de Aceite

- [ ] `Tag` e `TranscriptTag` no schema + migration idempotente
- [ ] Gerar tags individual (detalhe) e em lote (biblioteca) — só sem-tag no lote
- [ ] Tag nova cria pasta de mesmo nome; tag existente reutilizada por slug
- [ ] `folderId` é setado só quando vazio (primeira tag); nunca move conteúdo já
      com pasta
- [ ] Busca da biblioteca casa por tag (nome/slug)
- [ ] Tags aparecem como chips (tema zinc) no card e no detalhe
- [ ] `CostEvent` com `source: tag_generation` / `tag_generation_backfill`
- [ ] Testes: slug, dedup/pós-processamento, e regra de folderId (só se vazio)
- [ ] i18n PT-BR + demais idiomas presentes

## Fora de Escopo

- Geração automática de tags no worker (por ora só sob demanda via botão)
- Renomear/mesclar tags legadas, editar tags manualmente na UI
- Filtro dedicado por tag na sidebar (busca por texto já cobre)
- Hierarquia de tags

## Riscos

- Proliferação de tags/pastas se a IA inventar sinônimos — mitigado por lista de
  existentes no prompt + dedup por slug + cap 5.
- +1 call LLM barata por conteúdo (sob demanda, custo registrado em CostEvent).
- Migration só validável no deploy do owner (sem DB local) — escrita à mão,
  idempotente (`IF NOT EXISTS`).
