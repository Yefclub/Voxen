# Spec 144 — Recuperação híbrida semântica opt-in

## Contexto

O Brain já persiste embeddings opcionais no `metadata` dos nós `CONTENT`, mas a
busca de transcrições só reordena hits FTS com o vetor do primeiro resultado.
Isso não encontra uma fonte cuja redação não compartilha keywords com a pergunta.

## Requisitos

### Ubiquitous

- O sistema DEVE manter Postgres FTS como caminho lexical padrão.
- Quando `embeddings_enabled` estiver ativo, o sistema DEVE gerar o embedding da
  consulta com a chave e o modelo OpenRouter configurados.
- O sistema DEVE procurar candidatos semânticos somente entre nós `CONTENT`
  ativos do mesmo `userId` que tenham vetores válidos persistidos.
- O sistema DEVE fundir os candidatos lexical e semântico com score explicável e
  marcar internamente cada resultado como `lexical`, `semantic` ou `hybrid`.
- O armazenamento vetorial DEVE permanecer no metadata JSON existente, sem
  extensão Postgres, serviço externo ou migração obrigatória.

### Event-driven

- Quando FTS não retornar resultados ou o melhor score lexical estiver baixo, o
  sistema DEVE usar candidatos semânticos como resgate.
- Quando uma fonte estiver nos dois ramos, o sistema DEVE classificá-la como
  `hybrid` e usar o score fundido para a ordenação.
- Quando a geração do embedding da consulta falhar, o sistema DEVE retornar os
  resultados FTS já calculados sem propagar o erro para chat ou MCP.

### Unwanted behaviour

- Se embeddings estiverem desativados, o sistema NÃO DEVE consultar a OpenRouter
  nem carregar vetores do Brain.
- O sistema NÃO DEVE retornar conteúdo de outro usuário durante busca semântica.
- O sistema NÃO DEVE transformar uma falha opcional de embeddings em falha de
  recuperação lexical.

## Critérios de aceite

- Uma consulta semanticamente equivalente encontra uma transcrição mesmo sem
  keyword literal.
- Com embeddings desativados, FTS e seu custo permanecem inalterados.
- A fusão informa a origem lexical, semântica ou híbrida para depuração.
- Falha de embedding degrada para FTS.
- Testes cobrem recall semântico, fusão, fallback e isolamento por usuário.
