# Spec 077 — Auditoria e correção de consistência de temas

## Status

Em implementação (2026-07-12).

## Contexto

O owner relatou dois problemas concretos de tema (spec 073 introduziu os temas `zinc`,
`emerald`, `light`):

1. Textos ilegíveis / baixo contraste no tema **light**.
2. Cards/superfícies cinzas que "não dá pra ver direito" e não batem com o tema ativo.

Causa raiz: dezenas de componentes e páginas usavam **cores Tailwind fixas** (`text-zinc-*`,
`bg-zinc-*`, `border-zinc-*`, `bg-zinc-100/[0.03]`, `bg-zinc-950/95`, hex/oklch inline em
utilitários CSS) em vez dos **tokens semânticos** `--color-app-*` definidos por tema. Cores
fixas não invertem no tema light → texto claro sobre fundo claro (ilegível) e superfícies
que ficam presas na aparência dark.

## Glossário

- **Token semântico**: variável CSS `--color-app-*` / `--color-accent-*` definida nos 3 blocos
  `[data-theme=...]` em `apps/web/src/client/index.css`. É a **fonte da verdade** de cor.
- **Superfície inversa**: cor sólida de alto contraste (botão default / segmento ativo) que
  precisa inverter por tema — clara no dark, escura no light.

## Regras de tema (fonte da verdade)

- Superfícies neutras → `--color-app-bg` / `--color-app-bg-elevated` / `--color-app-surface` /
  `--color-app-surface-hover`.
- Texto → `--color-app-fg` (principal) / `--color-app-subtle` (secundário) / `--color-app-muted`
  (terciário/legenda/placeholder).
- Bordas → `--color-app-border` / `--color-app-border-strong`.
- Acentos intencionais (emerald=ativo, rose=destrutivo, amber=aviso, violet) preservam a
  semântica; usa-se `-soft` para fundos de acento.

## Tokens novos (adicionados nos 3 temas + defaults)

- `--color-app-inverted` / `--color-app-inverted-fg` / `--color-app-inverted-hover`: superfície
  sólida de alto contraste para o botão `default`, segmentos ativos (admin custos, onboarding,
  setup) e o botão de retry do error boundary. Clara no dark, escura no light.
- `--color-app-elevate`: realce sutil no topo de cards `elevated` (branco a 4% no dark, preto a
  2% no light) — substitui um gradiente `oklch(...)` fixo que escurecia cards no light.
- `--theme-mesh-c`: terceiro radial do mesh de fundo (`body::before`). Antes era um `oklch(28%)`
  fixo que manchava o centro no tema light; agora é `transparent` no light.

## Requisitos (EARS)

### Ubiquitous

- O sistema DEVE usar exclusivamente tokens semânticos `--color-app-*` para superfícies neutras,
  texto neutro e bordas neutras em todo `apps/web/src/client`.
- O sistema DEVE preservar cores de acento intencionais (emerald/violet/amber/rose) e cores
  deliberadamente independentes de tema (scrims `bg-black/*` de modais e mídia, fundo branco de
  QR code, texto branco sobre botão de acento colorido).

### Event-driven

- Quando o usuário troca para o tema `light`, então todo texto neutro DEVE permanecer legível
  (contraste adequado) e nenhuma superfície neutra DEVE renderizar com aparência dark.
- Quando o usuário troca para o tema `light`, então o título hero (`.text-gradient`) e os cards
  `elevated` DEVEM renderizar com cores derivadas do tema (não mais `oklch` fixo claro).

### State-driven

- Enquanto um `Switch` está desligado no tema `light`, o knob DEVE permanecer visível (trilho em
  `--color-app-border-strong` + knob claro com `shadow-sm`).

## Varredura realizada

- Grep amplo por `text/bg/border-(zinc|gray|neutral|slate|white|black)` e `oklch(`/hex inline em
  `apps/web/src/client/**`. A base usa apenas a paleta `zinc` + `white`/`black` (sem gray/neutral/
  slate).
- ~340 ocorrências neutras trocadas por tokens em 47 arquivos (componentes `ui/*`, layout,
  ingest, notes, model-picker, update-modal e todas as páginas).
- Utilitários CSS theme-aware: `.text-gradient`, `.surface-elevated`, card `elevated` e o mesh
  central de `body::before`.

## Decisões de acento

- **Mantidos como estão**: classes de acento inline (`text-emerald-400`, `text-violet-300`,
  `bg-emerald-500/10`, badges `success/warning/danger`, botão de envio do chat, etc.). São
  intencionais e o design é dark-first.
- **Ressalva conhecida (follow-up)**: acentos em tonalidades claras (`-200/-300/-400`) sobre
  fundos de acento `-soft` podem ter contraste reduzido no tema `light`. Corrigir isso bem exige
  uma escala de acento por tema (incluindo overrides light + variantes `-soft` para amber/rose,
  hoje ausentes) e verificação visual — fora do escopo desta correção neutra. Fica registrado
  para uma próxima iteração.
- **Não-temáticos preservados**: `bg-black/*` (scrims de modal/mídia), `bg-white` do QR code
  (2FA precisa de fundo branco), `text-white` sobre `--color-accent-primary` (contraste ok nos
  dois temas), badges de fonte "WEB" em cinza neutro, e o knob do `Switch` (branco em ambos os
  temas por design, com `shadow-sm` para separar do trilho claro).

## Fora de escopo

- Refatorar componentes que já usavam tokens.
- Redesenho da escala de acentos por tema (registrado como follow-up).
- Mudanças de layout, espaçamento ou comportamento — esta correção é só cor/tema.
