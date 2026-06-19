# 049 — Correções de responsividade e overflow de texto (apps/web)

## Contexto

Auditoria read-only do frontend (`apps/web`) levantou problemas de
responsividade e overflow que degradam a experiência em telas pequenas
(mobile). Como o Voxen é um PWA self-hosted acessado também pelo celular, modais
que estouram a viewport, padding fixo sem breakpoint, texto longo que rompe o
layout (sob `overflow-x: clip` global) e alvos de toque inalcançáveis são
problemas reais de uso.

Esta spec cobre apenas correções **mecânicas de apresentação** — classes Tailwind
responsivas, quebra de texto, `dvh` e visibilidade de alvos de toque. NÃO há
mudança de lógica, estado ou fetch (escopo de outra entrega — ver 048). Mudanças
que exigem reestruturação de layout com risco de reflow ficaram **deferidas para
validação visual** e estão listadas no final.

Observação: como esta sessão não tem Playwright, todas as mudanças foram
deliberadamente conservadoras — apenas adições de classes utilitárias de baixo
risco. Itens que reestruturariam markup de forma arriscada foram deixados de
fora.

Problemas identificados e corrigidos:

1. **`DialogContent` estoura a viewport.** Sem `max-h`/`overflow` e com `w-full`
   sem margem segura, modais com muito conteúdo ultrapassam a tela no mobile e o
   topo/base ficam inacessíveis. O texto "Fechar" estava hardcoded em vez de usar
   i18n.
2. **Padding fixo `px-8 py-12` sem breakpoint** em várias páginas, desperdiçando
   espaço horizontal precioso no mobile. Referência correta: `jobs.tsx`
   (`px-4 sm:px-6`).
3. **Texto longo sem quebra** (bolha do usuário no chat, channel/autor da
   transcrição, corpo da transcrição, código `/start {code}` da conta) rompe o
   layout horizontal sob o `overflow-x: clip` global.
4. **`100vh`/`vh`** em `notas.tsx` e `media-viewer.tsx` ignora a barra de URL
   móvel; `dvh` é o correto para viewport dinâmica.
5. **Grids fixos sem colapso mobile** (`grid-cols-2`/`grid-cols-3`) apertam ou
   cortam conteúdo em telas estreitas.
6. **Badges com largura fixa** (`w-28`) cortam labels de status traduzidos mais
   longos.
7. **Botão de excluir nota inalcançável no toque** (`opacity-0 group-hover`),
   pois dispositivos touch não têm estado de hover.
8. **Linhas de usuário no admin sem `min-w-0`/truncate**: email longo pode
   empurrar o layout.

## Requisitos (EARS)

- **R1** — Enquanto um `Dialog` estiver aberto, o sistema DEVE limitar a altura do
  conteúdo a no máximo 90% da viewport dinâmica (`max-h-[90dvh]`) com rolagem
  vertical interna, e DEVE garantir largura segura no mobile
  (`w-[calc(100vw-2rem)]` respeitando o `max-w` existente).
- **R2** — O botão de fechar do `Dialog` DEVE usar a chave de i18n existente
  (`common.close`) em vez de texto hardcoded.
- **R3** — Quando a viewport for estreita (mobile), as páginas de conteúdo
  (`dashboard`, `admin-usuarios`, `admin-custos`, `conta`, `login`, `cadastro`,
  `notas`) DEVEM usar padding horizontal reduzido (`px-4`) e expandir para o
  padding maior a partir de `sm`.
- **R4** — Quando um texto longo (conteúdo de mensagem do usuário, channel/autor,
  corpo de transcrição, código do Telegram) não couber na largura, o sistema DEVE
  quebrar o texto (`break-words`/`break-all`/`overflow-wrap`) em vez de estourar
  horizontalmente.
- **R5** — Os containers cuja altura depende da viewport (`notas.tsx`,
  `media-viewer.tsx`) DEVEM usar unidades de viewport dinâmica (`dvh`) em vez de
  `vh`.
- **R6** — Quando a viewport for estreita, os grids de sugestões (chat empty
  state) e de quick prompts (chat inline da transcrição) DEVEM colapsar para
  menos colunas (`grid-cols-1`/`grid-cols-2`) e expandir a partir de `sm`.
- **R7** — As badges de status de job (`dashboard`, `jobs`) DEVEM ter largura
  mínima (`min-w-28`) e poder crescer para acomodar labels mais longos, em vez de
  largura fixa que corta o texto.
- **R8** — O botão de excluir nota na árvore de notas DEVE ser visível por padrão
  em telas de toque (mobile) e só depender de hover a partir de `sm`.
- **R9** — As linhas de usuário no admin (pendentes e demais) DEVEM aplicar
  `min-w-0` e quebra/truncate no email para que endereços longos não empurrem os
  botões de ação para fora da tela.

## Não-objetivos

- Não alterar lógica, estado, fetch ou comportamento — apenas apresentação.
- Não introduzir bibliotecas novas.
- Não mexer em `markdown.tsx` (já corrigido em outra entrega).
- Não reescrever `automacoes.tsx` (escopo de outra entrega).
- Não reestruturar markup de forma arriscada — itens que exigiriam isso ficaram
  deferidos para validação visual (ver abaixo).

## Deferido para validação visual no mobile

Itens fora desta entrega por exigirem verificação visual (sem Playwright nesta
sessão) ou reestruturação com risco de reflow:

- Reescrita de `automacoes.tsx` (fora do tema).
- Qualquer reflow complexo de layout em cards/grids além das mudanças mecânicas
  acima.
- `dashboard.tsx` ActivityRow: já possui `flex-1 min-w-0` + `truncate` + arrow
  `shrink-0` — verificado, não precisa de mudança.
- Validação visual de todos os modais com o novo `max-h-[90dvh]`/largura em telas
  reais (o comportamento de rolagem interna deve ser conferido com conteúdo
  longo).

## Critérios de aceite

- `make lint`, `make typecheck`, `make test-ts` e `bun run build` (em `apps/web`)
  verdes.
- Nenhuma mudança de lógica/estado/fetch (apenas classes utilitárias e i18n).
- `DialogContent` com `max-h-[90dvh] overflow-y-auto` e largura segura no mobile.
- Botão "Fechar" do dialog usando `t('common.close')`.
- Validação visual final no mobile pendente (documentada na PR).
