# 109 — Descoberta de tags escalável na Biblioteca

## Contexto

A Biblioteca Viva exibe tags como filtro rápido, mas a primeira versão entrega todas as tags ativas em uma única resposta e as mantém renderizadas no seletor. Em acervos grandes isso aumenta o tempo de carregamento e torna a descoberta ruim em tela pequena.

## Requisitos

- **REQ-1**: `GET /api/library/tags` DEVE aceitar `q`, `limit` e `offset`, sempre limitado e escopado ao usuário autenticado.
- **REQ-2**: A resposta DEVE incluir `total`, `hasMore`, `limit` e `offset`, além das tags e de suas contagens de conteúdo ativo.
- **REQ-3**: A Biblioteca DEVE carregar somente um conjunto curto de tags prioritárias para os chips iniciais.
- **REQ-4**: O seletor de tags excedentes DEVE pesquisar no servidor, apresentar resultados paginados e permitir carregar mais sem perder a consulta atual.
- **REQ-5**: Uma tag selecionada fora dos chips iniciais DEVE continuar identificável como filtro ativo no seletor.

## Fora de escopo

- Alterar o modelo de tags, pastas ou transcrições.
- Criar sinônimos, hierarquia de tags ou classificação por IA.
- Cache offline do catálogo de tags.

## Critérios de aceite

- Busca, paginação e contagens da API não cruzam workspaces.
- O carregamento inicial não transfere o catálogo inteiro de tags.
- Os filtros de tag existentes continuam combinando com Inbox, pasta, semana, status e busca textual.
- Há testes de API para busca/paginação e testes existentes continuam verdes.
