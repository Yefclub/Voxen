# 047 — Query expansion no FTS de transcrições (sem embeddings)

## Contexto

O agente de chat (`apps/chat`) navega o acervo via tools determinísticas sobre
Postgres FTS — sem embeddings/RAG vetorial (ADR-004, abordagem harness/Karpathy).
A tool `search_transcripts` (`db.search_user_transcripts`) hoje monta a query com
`plainto_tsquery('portuguese', $2)`. Isso tem dois limites de **recall**:

1. **AND implícito** — `plainto_tsquery` une todos os lexemes com `&`, ou seja, um
   documento só casa se contiver **todas** as palavras da query. Buscas naturais
   de 3-5 palavras ("como o cara falou de marketing digital") tendem a não casar
   nada mesmo quando há trechos altamente relevantes.
2. **Gap lexical** — o usuário usa um termo, a transcrição usa outro
   (sinônimo/termo relacionado). O dicionário `portuguese` já faz stemming
   (singular/plural e conjugações colapsam pro mesmo lexema), mas não resolve
   sinônimos.

O dicionário português do Postgres **já cobre** singular/plural e flexões via
stemming, então expansão morfológica não precisa de LLM nem de lista manual.

## Decisão de design

Avaliadas duas abordagens (detalhe em ADR-004, nota de extensão):

- **(a) Expansão com LLM dentro da tool**: gerar 2-3 reformulações via chamada LLM
  barata e fundir resultados. **Rejeitada** como default: adiciona latência (uma
  ida ao OpenRouter por busca, ~300-1500ms) e custo por busca, e quebra o
  determinismo do harness (ADR-004 — tools devem ser determinísticas, read-only,
  sem efeito colateral).
- **(b) Expansão a nível de FTS (sem LLM)**: reescrever a query para `tsquery`
  combinando os lexemes com **OR + prefix matching (`:*`)** e injetando sinônimos
  de um mapa curado PT-BR, mantendo `ts_rank` para que documentos que casem mais
  termos subam. **Escolhida** — custo zero, latência zero, 100% determinística e
  no Postgres. Alinhada com ADR-004.

**Híbrido escolhido**: a query do usuário é convertida em um `tsquery` construído
em SQL via `to_tsquery('portuguese', :expanded)`, onde `:expanded` é montado em
Python a partir dos termos da query do usuário:

- cada termo vira `termo:*` (prefix match — pega "market" → "marketing");
- termos são unidos por `|` (OR) em vez de `&` (AND);
- sinônimos de um mapa estático PT-BR são adicionados como alternativas `|`.

`ts_rank` continua ordenando por relevância — docs que contêm mais dos termos
expandidos rankeiam acima dos que contêm poucos. O fallback para
`plainto_tsquery` é mantido quando a expansão resultar em query vazia.

A expansão é uma **pure function** (`expand_fts_query`) testável isoladamente,
sem I/O. A fusão/dedup é trivial porque uma única `tsquery` OR já retorna o
conjunto unido — não há N buscas a deduplicar; o dedup natural do FTS por linha
(transcript) é preservado. (A alternativa de N queries separadas + merge em
Python foi descartada: a OR em uma única `tsquery` é mais barata, atômica e já
deduplica por construção.)

## Requisitos (EARS)

- **R1** — Quando `search_transcripts` receber uma query não vazia, o sistema DEVE
  expandir a query para uma `tsquery` que une os lexemes com OR e prefix match
  (`:*`), ampliando o recall sem exigir que o documento contenha todos os termos.
- **R2** — Quando um termo da query tiver sinônimo(s) no mapa curado PT-BR, o
  sistema DEVE incluir o(s) sinônimo(s) como alternativa(s) OR na `tsquery`.
- **R3** — Enquanto a expansão produzir uma `tsquery` válida, o sistema DEVE
  ordenar os resultados por `ts_rank` (relevância) e desempate por `createdAt`
  desc, preservando o formato de retorno atual (`id`, `title`, `snippet`, `rank`).
- **R4** — Quando a query, após sanitização, não produzir nenhum termo utilizável,
  o sistema DEVE cair para `plainto_tsquery` (comportamento atual) e nunca lançar
  erro de sintaxe de `tsquery`.
- **R5** — O sistema DEVE remover/escapar caracteres que são operadores de
  `tsquery` (`& | ! ( ) : * ' \`) vindos da query do usuário, para impedir
  injeção de sintaxe `tsquery` e erros 500.
- **R6** — Toda busca DEVE permanecer escopada por `userId` (isolamento de
  workspace — `WHERE "userId" = $1`); a expansão NÃO altera o escopo nem vaza
  dados de outro usuário.
- **R7** — A tool DEVE permanecer read-only e determinística (mesma query → mesma
  `tsquery` → mesmos resultados); sem chamadas externas, sem efeito colateral.
- **R8** — A fusão de resultados DEVE deduplicar por transcript (uma linha por
  `id`); como a expansão usa uma única `tsquery` OR, o dedup é garantido por
  construção (sem duplicatas no retorno).

## Não-objetivos

- Não introduzir embeddings/pgvector (contraria ADR-004).
- Não chamar LLM por busca (custo/latência/determinismo).
- Não alterar o schema Prisma nem a trigger do `tsvector` (a coluna
  `searchVector` continua igual; mudamos só a query de leitura).
- Não mudar o contrato/forma de retorno da tool nem os timestamps dos trechos.
- Não aplicar a mesma expansão a `search_notes`/`brain_search` neste PR (escopo
  fechado em `search_transcripts`; pode ser extensão futura reusando o helper).

## Critérios de aceite

- `expand_fts_query("marketing digital")` gera uma `tsquery` com OR + `:*` e, se
  houver sinônimo mapeado, inclui as alternativas.
- Fusão deduplica: o retorno tem no máximo uma linha por `id` de transcript.
- Scoping por `userId` mantido (a SQL continua filtrando `WHERE "userId" = $1`).
- Query vazia / só de operadores não quebra (cai no fallback, sem exceção).
- `make lint`, `make typecheck`, `make test-py` verdes; `ruff format --check`
  limpo em `apps/chat`.
