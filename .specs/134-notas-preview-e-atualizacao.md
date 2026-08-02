# Spec 134 — Notas em Preview e atualização ao retornar

## Contexto

A lista de notas mantém um cache compartilhado no cliente. Quando uma nota é
criada por uma automação, pelo chat ou pelo MCP, esse cache não é atualizado e a
pessoa precisa recarregar manualmente a página de Notas para encontrá-la. Além
disso, a abertura de uma nota expõe o editor antes de uma ação explícita de
edição.

## Glossário

- **Preview**: visualização de uma nota sem campos editáveis.
- **Revalidação**: consulta atualizada da lista sem recarregar a página inteira.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall abrir cada nota em Preview, com título e conteúdo somente leitura.
- The system shall exibir os campos editáveis apenas depois de a pessoa escolher Editar.

### Event-driven (resposta a evento)

- When a pessoa entra na página de Notas, the system shall revalidar a lista de notas mesmo que exista cache local.
- When a pessoa retorna à aba ou à janela com a página de Notas visível, the system shall revalidar a lista de notas.
- When a pessoa seleciona outra nota, the system shall abrir a nota recém-selecionada em Preview.

### State-driven (durante um estado)

- While uma nota está em Preview, the system shall impedir edição de título e conteúdo.

### Optional (feature opcional)

- Where a revalidação falhar, the system shall manter os itens já carregados para que a navegação existente continue disponível.

### Unwanted behavior (condições de erro)

- If uma consulta de revalidação falhar, then the system shall encerrar o estado de carregamento sem apagar a lista em cache.

## Critérios de Aceite

- [ ] Abrir `/notas` após uma criação externa mostra a nota sem recarregar a página manualmente.
- [ ] Retornar à aba com Notas revalida a árvore de notas.
- [ ] Abrir uma nota pela rota ou pela árvore mostra Preview inicialmente.
- [ ] No Preview, título e conteúdo não podem ser alterados.
- [ ] Editar troca para o editor e trocar de nota volta ao Preview.
- [ ] Falha de revalidação não limpa a lista já visível.

## Fora de Escopo

- Atualização em tempo real por websocket/SSE enquanto a pessoa permanece em outra página.
- Alterar o conteúdo criado pela IA, MCP ou automações.

## Riscos / Decisões pendentes

- A atualização é disparada por entrada/retorno à página, pois cobre a navegação
  imediatamente após uma criação externa sem manter uma conexão persistente.

> 2026-08-02: aprovada pelo usuário antes da implementação.
