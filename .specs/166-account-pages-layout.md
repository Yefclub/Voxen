# Spec 166 — Layout das páginas de conta

## Contexto

As páginas `/conta`, `/conta/plataformas` e `/conta/mcp` usam uma largura de leitura isolada e não apresentam uma navegação interna comum. Isso faz os controles pessoais parecerem páginas avulsas e reduz a distinção visual entre preferências do usuário e administração da instância.

## Requisitos

### R1 — Estrutura comum

- **Quando** uma página pessoal de conta for aberta, **então** ela deve usar a largura padrão de workspace das demais páginas da aplicação.
- **Quando** uma das três páginas for aberta, **então** deve exibir uma navegação comum para Perfil e segurança, Contas de plataforma e Acesso MCP.
- **Quando** o usuário estiver em uma seção, **então** o item correspondente deve indicar o estado atual com `aria-current="page"`.

### R2 — Responsividade

- **Quando** a largura permitir, **então** os cartões do perfil devem aproveitar duas colunas sem alterar a ordem de leitura do DOM.
- **Quando** a tela for estreita, **então** a navegação deve permitir rolagem horizontal e os cartões devem retornar a uma coluna.

### R3 — Isolamento conceitual

- **Quando** o usuário navegar por essas páginas, **então** os rótulos e destinos devem representar apenas configurações pessoais, sem atalhos ou linguagem de administração da instância.

## Aceite

- [x] As três páginas usam `PageShell` com largura `wide`.
- [x] As três páginas compartilham a mesma navegação de conta.
- [x] O item ativo é acessível e visualmente distinguível.
- [x] O perfil usa duas colunas apenas em telas largas.
- [x] Não há alteração em APIs, autorização ou persistência.
