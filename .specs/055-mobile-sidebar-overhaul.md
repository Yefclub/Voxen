# 055 — Overhaul da navegação mobile (drawer full-screen + bottom nav)

## Entendimento do pedido

O owner relatou três problemas de UX/performance no shell mobile e um bug visual:

1. A sidebar "trava/pesa" no mobile. A causa real é que o componente `Sidebar`
   (desktop) e seu corpo modo-aware (`SidebarModeBody`, que monta os hooks
   pesados `useConversations` e `useNotes`) ficam **montados** abaixo do
   breakpoint, apenas ocultos via CSS (`hidden md:flex`). No mobile isso roda
   fetches e mantém árvore de notas/conversas viva sem necessidade.
2. Itens do cabeçalho (perfil/usuário) devem ir para a **barra inferior** no
   mobile, deixando o `topbar` enxuto. No desktop nada muda.
3. Abrir a sidebar com **swipe da borda esquerda → direita**, abrindo um drawer
   que **cobre a tela inteira** no mobile (no desktop a sidebar continua
   flutuante/recolhível como hoje). Tem que ter **também um botão** (hambúrguer,
   já existe) para acessibilidade. Fechar: swipe de volta, tap no overlay, botão
   X e tecla Esc.
4. O chevron do menu de perfil colapsável na sidebar (modos chat/notas) está
   invertido: hoje `menuOpen ? 'rotate-180' : ''` — deve apontar para a direção
   correta de abertura.

## Decisões e desvios (importante)

- **Breakpoint mantido em `md` (768px), não `lg`.** O shell inteiro (sidebar,
  drawer, bottom-nav, botão voltar do topbar, spacer) usa `md:` como fronteira
  mobile/desktop. O owner sugeriu `lg:`, mas trocar só a sidebar para `lg`
  criaria uma faixa morta entre 768–1024px onde a sidebar some e o bottom-nav
  (que é `md:hidden`) também some → sem navegação. Para honrar "desktop
  INALTERADO" e não introduzir bug, a fronteira segue `md` de forma consistente.
  O efeito desejado pelo owner (mobile leve, drawer full-screen, perfil embaixo)
  é entregue mantendo `md`. Se o owner quiser explicitamente mover TODO o shell
  para `lg`, é uma mudança separada e coordenada nos 5 arquivos.
- **Performance**: o fix é desmontar (não só esconder) o conteúdo pesado no
  mobile. `Sidebar` passa a retornar `null` abaixo de `md` via hook
  `useIsDesktop()` (matchMedia). O `SidebarSpacer` idem. O drawer já só monta o
  corpo quando `open`.
- **Sem lib nova**. Swipe via handler `touchstart/touchmove/touchend` leve com
  detecção de borda esquerda + threshold, encapsulado em `useEdgeSwipe`. Sem
  re-render durante o gesto (usa refs).

## Requisitos (EARS)

- **R1** — Enquanto a viewport for < 768px, o sistema NÃO DEVE montar o
  componente `Sidebar` desktop nem o `SidebarSpacer` (render condicional, não só
  CSS), evitando os fetches de conversas/notas no mobile.
- **R2** — Enquanto a viewport for ≥ 768px, o shell desktop DEVE permanecer
  idêntico ao comportamento atual (sidebar flutuante recolhível, spacer,
  topbar com avatar/menu, sem bottom-nav, sem drawer).
- **R3** — Enquanto a viewport for < 768px, a `MobileBottomNav` DEVE exibir o
  acesso ao perfil/usuário (avatar + menu com Perfil e Sair), além dos itens de
  navegação atuais.
- **R4** — Enquanto a viewport for < 768px, o `Topbar` NÃO DEVE exibir o
  avatar/menu de usuário (movido para a bottom-nav); o hambúrguer e o botão
  voltar permanecem.
- **R5** — Quando o usuário fizer swipe a partir da borda esquerda em direção à
  direita (acima de um threshold) numa viewport < 768px, o sistema DEVE abrir o
  `MobileNavDrawer`.
- **R6** — Enquanto aberto numa viewport < 768px, o `MobileNavDrawer` DEVE
  cobrir a tela inteira (largura total), respeitando `safe-area-inset`.
- **R7** — Quando o usuário tocar no overlay, no botão X, pressionar Esc, fizer
  swipe de volta (direita → esquerda) ou navegar, o sistema DEVE fechar o
  drawer.
- **R8** — Quando o menu colapsável de perfil (modos chat/notas) estiver aberto,
  o chevron DEVE apontar na direção correta de aberto (invertido em relação ao
  comportamento atual), nas DUAS ocorrências.
- **R9** — O sistema NÃO DEVE introduzir strings hardcoded; novas labels usam
  `t()` com chave nos dois locales (pt-BR e en).

## Fora de escopo

- Mudar lógica de auth/navegação.
- Redesign visual do desktop.
- Mover TODO o shell de `md` para `lg`.

## Validação visual pendente (sem Playwright nesta worktree)

Precisa de teste manual no mobile real / devtools responsivo:

- Swipe da borda esquerda abre o drawer; swipe de volta fecha; threshold não
  dispara em scroll vertical normal.
- Drawer ocupa a tela inteira no mobile e respeita o notch (safe-area).
- Bottom-nav com 5 itens (4 nav + perfil) cabe sem quebrar em telas estreitas
  (320–360px); o menu de perfil abre acima da nav (z-index/posicionamento).
- Topbar sem avatar no mobile, com avatar no desktop.
- Desktop ≥ 1024px e tablet 768–1023px idênticos ao atual.
- Chevron aponta corretamente nos modos chat e notas.
