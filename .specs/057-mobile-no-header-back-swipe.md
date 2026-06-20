# 057 — Mobile sem header: botão de voltar + drawer por edge-swipe

## Entendimento do pedido

Sequência do overhaul mobile (spec 055). O owner pediu quatro coisas, todas
**mobile-only** (`< md`, 768px), com o **desktop INALTERADO** (≥ 768px):

1. **Remover o cabeçalho (Topbar) por completo no mobile.** Hoje o `Topbar`
   ainda monta abaixo de `md` com hambúrguer e botão de voltar. No mobile não
   deve haver header nenhum — a navegação é 100% via bottom-nav + gesto + botões
   de voltar. O Topbar continua **só no desktop**. Remover o header não pode
   deixar buraco/espaço no topo: o conteúdo começa do topo respeitando
   `safe-area-inset-top`.
2. **Botão de voltar no nível do `app-layout`** (não página por página),
   mobile-only (`md:hidden`), no topo da área de conteúdo (respeitando
   safe-area), que aparece em rotas que **não** são abas do bottom-nav. As abas
   de topo (destinos do bottom-nav) não mostram voltar. Detecção via
   `useLocation`. Ação: `useNavigate(-1)`. Ícone `ArrowLeft` + texto i18n
   "Voltar" (`common.back`, já existe nos 2 locales).
3. **Gesto swipe L→R abre a sidebar (drawer)** — revisar e robustecer o
   `use-edge-swipe.ts` existente (zona de borda, threshold, ângulo, listeners
   passivos limpos, ligado só no mobile). Como o header foi removido, garantir um
   **fallback acessível** para abrir a sidebar sem o gesto.
4. **Não reintroduzir header no mobile** de forma alguma.

## Pesquisa de padrões mobile (2025/2026)

Fundamenta as decisões abaixo:

- **Gestos são aceleradores opcionais, não o único caminho.** Manter controles
  visíveis para ações centrais; o swipe é atalho para usuários experientes, mas
  é pouco descobrível. → justifica o **botão de menu (fallback) sempre visível**
  para abrir o drawer.
- **Navigation drawer é apropriado quando há > 3 top-level views** que não cabem
  nas tabs fixas. O bottom-nav do Voxen tem 5 slots (chat, jobs, transcrições,
  grafo, perfil); o drawer carrega os destinos únicos (dashboard, notas,
  automações, admin/usuários, admin/custos, admin/integracoes, setup). Logo o
  drawer **continua necessário** e precisa ser alcançável sem o gesto.
- **Conflito do edge-swipe com o "voltar" do browser (PWA).** Em PWA rodando no
  navegador, o swipe da borda esquerda colide com o gesto nativo de voltar do
  browser/OS. É confiável apenas em **PWA instalado (standalone)**. Não se deve
  tentar hackear o back do browser (preventDefault no edge não é confiável e
  quebra acessibilidade). → documentado como caveat conhecido; o **fallback por
  botão** mitiga o caso do browser.

Fontes: Sidekick Interactive (gesture nav best practices), Android Developers
(navigation drawer / gesture conflicts), Ionic #22299 (PWA back-gesture
conflict).

## Decisões e desvios (importante)

- **Topbar passa a ser desktop-only por render condicional no `app-layout`**
  (`{isDesktop && <Topbar/>}`), não só CSS. Remover do Topbar o que era
  mobile-only e virou código morto: botão hambúrguer, botão de voltar mobile, a
  prop `onOpenMobileNav` e o helper `getMobileBackTarget`. (CLAUDE.md: sem código
  morto.) O `ContextIndicator` é `hidden sm:flex` e segue só no desktop.
- **Nova barra superior mobile no `app-layout`** (`MobileTopBar`, `md:hidden`,
  `padding-top: env(safe-area-inset-top)`), enxuta (altura ~3rem), com:
  - **Botão de menu** (ícone `Menu`) à esquerda — abre o drawer. É o **fallback
    acessível** do gesto, presente em **todas** as páginas mobile (garante acesso
    aos destinos únicos do drawer sem swipe).
  - **Botão de voltar** (`ArrowLeft` + "Voltar"), via `navigate(-1)`, exibido
    **apenas em sub-páginas** — rotas que NÃO são abas do bottom-nav.
- **Taxonomia de rotas (topo vs sub-página).** "Topo" = destinos do bottom-nav:
  `/chat`, `/jobs`, `/transcricoes`, `/grafo` (match exato; sub-rotas tipo
  `/chat/:id` são sub-páginas). Todo o resto (`/dashboard`, `/notas`,
  `/automacoes`, `/admin/*`, `/setup`, `/conta`, e detalhes `*/:id`) é
  sub-página → mostra voltar. A barra mobile (com o botão de menu) aparece em
  todas, então o drawer é sempre alcançável.
- **Páginas full-bleed (`/chat`, `/grafo`).** O `/grafo` já tem barra flutuante
  própria com voltar + busca; para não duplicar, a `MobileTopBar` **não** é
  renderizada em `/grafo`. O `/chat` não tem header próprio e, sendo full-bleed,
  não tem bottom-nav — por isso recebe a `MobileTopBar` (voltar quando em
  `/chat/:id`; sempre o menu para trocar de conversa/navegar). A `MobileTopBar`
  entra no fluxo do flex column acima do `<main>`, então funciona tanto em
  páginas com scroll quanto full-bleed (apenas reduz a altura de `main`).
- **`use-edge-swipe.ts` revisado.** O hook já estava correto no essencial (zona
  de borda, threshold, ângulo, listeners passivos em `window` limpos no unmount,
  sem re-render via refs, `enabled = !isDesktop`). Ajustes: thresholds
  calibrados conforme o pedido (edgeZone 24px, minDistance 60px) e comentários
  atualizados. Lógica pura `isOpenSwipe`/`isCloseSwipe` mantida e coberta por
  teste.
- **Sem lib nova.** Reuso de `motion/react`, `lucide-react`, handlers de touch
  existentes. Sem re-render durante o gesto.
- **Breakpoint mantido em `md` (768px)** — consistente com spec 055.

## Requisitos (EARS)

- **Ub-1** Quando a viewport for `< md`, o sistema NÃO DEVE renderizar o `Topbar`
  (header) em nenhuma rota.
- **Ub-2** Quando a viewport for `≥ md`, o sistema DEVE renderizar o `Topbar`
  exatamente como hoje (desktop inalterado).
- **Ev-1** Quando o usuário estiver em uma rota que não é aba do bottom-nav (no
  mobile), o sistema DEVE exibir um botão de voltar que executa `navigate(-1)`.
- **Ub-3** Enquanto o usuário estiver numa aba do bottom-nav (`/chat`, `/jobs`,
  `/transcricoes`, `/grafo` exatos), o sistema NÃO DEVE exibir o botão de voltar.
- **Ub-4** Em todas as páginas mobile (exceto `/grafo`, que tem controles
  próprios), o sistema DEVE exibir um botão de menu que abre o drawer da sidebar.
- **Ev-2** Quando o usuário fizer swipe da borda esquerda → direita (startX ≤
  edgeZone, dx ≥ minDistance, |dy| ≤ |dx|·maxAngleRatio) no mobile com o drawer
  fechado, o sistema DEVE abrir o drawer.
- **Ev-3** Quando o usuário fizer swipe direita → esquerda com o drawer aberto, o
  sistema DEVE fechar o drawer.
- **Ub-5** O sistema DEVE respeitar `safe-area-inset-top` na barra mobile e
  `safe-area-inset-bottom` no bottom-nav, sem deixar espaço vazio no topo.

## Validação visual pendente (sem Playwright neste ambiente)

Itens que precisam de verificação em device/emulador mobile real (listados no
corpo da PR):

1. Ausência total de header no mobile e conteúdo encostando no topo
   (com notch/safe-area-inset-top respeitado, sem buraco).
2. Botão de voltar aparece nas sub-páginas e some nas abas do bottom-nav.
3. Botão de menu abre o drawer em todas as páginas (incl. `/chat`).
4. Edge-swipe L→R abre o drawer; swipe de volta fecha — em **PWA instalado**
   (caveat do browser documentado).
5. `/chat` mobile: voltar em `/chat/:id` e menu sempre acessível; input não
   colidindo com a barra superior.
6. `/grafo` mobile: sem barra superior duplicada (usa a flutuante própria).
7. Desktop ≥ 768px idêntico ao atual.

## Testes

- `use-edge-swipe.ts`: testes unitários de `isOpenSwipe`/`isCloseSwipe` cobrindo
  edgeZone, minDistance e maxAngleRatio (já existentes; estender se thresholds
  mudaram).
- Helper de taxonomia de rota (topo vs sub-página): teste unitário puro.
