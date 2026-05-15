# Monday — Integração com Monday.com

Skill para interagir com o Monday.com via MCP para documentação, atualização de status, e gestão de informações.

## Quando usar

- Usuário pede para atualizar o Monday com status de trabalho
- Documentar decisões técnicas em boards/docs do Monday
- Sincronizar informações entre GitHub (PRs/issues) e Monday
- Criar ou atualizar itens em boards de projeto
- Gerar documentação no Monday a partir de trabalho realizado

## Ferramentas MCP Disponíveis

```
mcp__claude_ai_monday_com__get_user_context     — contexto do usuário logado
mcp__claude_ai_monday_com__search               — buscar boards, items, docs
mcp__claude_ai_monday_com__get_board_info        — info de um board
mcp__claude_ai_monday_com__get_board_items_page  — itens de um board
mcp__claude_ai_monday_com__create_item           — criar item
mcp__claude_ai_monday_com__change_item_column_values — atualizar colunas
mcp__claude_ai_monday_com__create_update         — adicionar update/comentário
mcp__claude_ai_monday_com__create_doc            — criar documento
mcp__claude_ai_monday_com__add_content_to_doc    — adicionar conteúdo a doc
mcp__claude_ai_monday_com__read_docs             — ler documentos
mcp__claude_ai_monday_com__board_insights        — insights do board
```

## Fluxos Comuns

### Atualizar status de sprint/trabalho

1. Buscar o board relevante via `search`
2. Localizar o item correspondente via `get_board_items_page`
3. Atualizar colunas de status via `change_item_column_values`
4. Adicionar update com detalhes via `create_update`

### Documentar decisão técnica

1. Buscar ou criar doc no workspace relevante
2. Estruturar conteúdo: Contexto → Decisão → Alternativas consideradas → Motivo
3. Adicionar via `add_content_to_doc`

### Sincronizar GitHub → Monday

Quando PRs são criadas/mergeadas ou issues fechadas:
1. Localizar item correspondente no Monday
2. Atualizar status e adicionar link da PR/issue como update
3. Se não existir item, sugerir criação

### Criar relatório de progresso

Combinar com skills `changelog` ou `sprint-summary`:
1. Gerar dados via skill de relatório
2. Formatar para Monday (markdown compatível)
3. Criar/atualizar doc ou update no board relevante

## Regras

- Sempre buscar contexto primeiro (`get_user_context`, `search`) antes de criar/modificar
- Linguagem em PT-BR para todo conteúdo
- Não criar boards ou estruturas novas sem confirmação — apenas itens, updates e docs
- Se não encontrar o board/item esperado, perguntar ao invés de criar
- Conteúdo técnico deve ser acessível para não-devs quando em boards de gestão
- Manter formatação limpa — usar markdown do Monday, não HTML raw
