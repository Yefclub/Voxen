# 031 — Navegação mobile (hamburger + drawer)

## Contexto

A Sidebar do app shell é `hidden md:flex` — abaixo de 768px não existe NENHUMA navegação: sem acesso a painel, biblioteca, notas, jobs, grafo, admin, lista de conversas do chat, nem ao botão Sair. O Topbar permanece visível em todas as larguras, mas só oferece o menu do usuário.

A correção: extrair o conteúdo interno da Sidebar (nav items + modos chat/notas + sair) em componentes reutilizáveis e adicionar, em telas `<md`, um botão hamburger no Topbar que abre um drawer overlay deslizando da esquerda (motion/react) com exatamente o mesmo conteúdo modo-aware da sidebar desktop. O projeto não tem componente Sheet/Drawer — o drawer é construído com `AnimatePresence`/`motion.div`, seguindo o design system atual (`var(--color-app-*)`, bordas, blur).

## Requisitos (EARS)

- **REQ-1**: QUANDO a viewport for `<md` (768px), ENTÃO o Topbar DEVE exibir um botão hamburger (ícone `Menu`, `md:hidden`) no lado esquerdo, com `aria-label` i18n (`shell.openMenu`).
- **REQ-2**: QUANDO o usuário clicar no hamburger, ENTÃO um drawer overlay DEVE abrir deslizando da esquerda (motion/react: backdrop com fade + painel com slide), com z-index acima do shell (sidebar z-40/50, topbar z-30).
- **REQ-3**: O drawer DEVE conter o MESMO conteúdo modo-aware da sidebar desktop: em `/chat` a lista de conversas (nova/excluir/buscar + menu colapsável), em `/notas` a árvore de notas, nas demais rotas os itens de navegação (respeitando `adminOnly` por role) — mais o botão Sair no rodapé.
- **REQ-4**: O drawer DEVE fechar QUANDO: (a) a rota mudar (navegação), (b) o usuário clicar no backdrop, (c) o usuário clicar no botão X (`aria-label` `shell.closeMenu`), (d) o usuário pressionar Escape.
- **REQ-5**: O conteúdo do drawer DEVE rolar internamente (`overflow-y-auto`) e o painel DEVE receber foco ao abrir (foco gerenciado razoavelmente).
- **REQ-6**: Em viewports `md+`, o comportamento da sidebar DEVE permanecer IDÊNTICO ao atual (incluindo collapse/expand) — zero regressão visual; o hamburger e o drawer não aparecem.
- **REQ-7**: As strings novas DEVEM existir em pt-BR e en (`shell.closeMenu`: "Fechar menu" / "Close menu"; `shell.openMenu` já existe).
- **REQ-8**: Os `layoutId` do motion usados nos itens de navegação (pill/dot) NÃO DEVEM conflitar entre a sidebar desktop (montada porém oculta via CSS) e o drawer mobile — escopo via `LayoutGroup`.

## Critérios de Aceite

- [ ] Em 375px de largura, todas as rotas do app são alcançáveis via hamburger → drawer (incluindo admin para ADMIN e Sair).
- [ ] Em `/chat` mobile, o drawer mostra a lista de conversas com criar/excluir/buscar; em `/notas`, a árvore de notas.
- [ ] Drawer fecha por navegação, backdrop, X e Escape.
- [ ] Em 1280px, sidebar desktop idêntica à atual (collapse funciona, sem hamburger visível).
- [ ] Lint, typecheck e build do `@voxen/web` verdes.

## Fora de Escopo

- Mudanças em `apps/web/src/client/index.css`, `pages/chat.tsx`, `routes/*` e `apps/chat/**` (PRs paralelos tocam esses arquivos).
- Gestos de swipe para abrir/fechar.
- Adaptações mobile de páginas internas (tabelas, grafo etc.) — esta spec cobre só a navegação do shell.
