# Spec 083 — Correção de rolagem horizontal indevida no mobile

## Status

Em implementação (2026-07-12).

## Contexto

Em viewports estreitos (mobile), o chat — e outras telas do app — permitiam que o
conteúdo fosse arrastado/rolado na horizontal, mesmo com `overflow-x: hidden` +
`overflow-x: clip` já aplicados globalmente em `html`, `body` e `#root`
(`apps/web/src/client/index.css`).

A causa raiz: essa proteção global só impede rolagem horizontal da PÁGINA como um
todo. Ela não alcança containers de rolagem PRÓPRIOS aninhados (elementos com
`overflow-y: auto`/`scroll` sem `overflow-x` explícito) — pela spec de CSS, quando
um eixo é `visible` e o outro não, o eixo `visible` passa a computar como `auto`.
Ou seja, qualquer scroller vertical do app (mensagens do chat, `<main>` do shell,
modais) que contivesse uma string sem espaços mais larga que o container (URL,
token, ID, hash, trecho de erro de API/terceiro) abria rolagem horizontal PRÓPRIA
naquele container, driblando a proteção global.

O componente `Markdown` (`apps/web/src/client/components/ui/markdown.tsx`) já
tratava isso com `break-words` desde sua criação. Esta spec estende a mesma defesa
para os pontos onde texto não controlado (resultado/erro de ferramenta, mensagem
do próprio usuário, erro de API, corpo de nota de release) é renderizado fora do
`Markdown`, e reforça os principais containers de rolagem do app com
`overflow-x-hidden` como cinto de segurança — independente da causa exata do
estouro.

`/grafo` está fora de escopo desta spec: outra frente de trabalho está
redesenhando essa página para mobile em paralelo.

## Glossário

- **Conteúdo não controlado**: texto que não é uma string fixa de tradução
  (`t('chave')`) — vem de API, banco, usuário ou serviço de terceiro (erro de
  execução de ferramenta, mensagem de erro HTTP, texto colado pelo usuário, corpo
  de changelog).
- **Scroller aninhado**: elemento com `overflow-y: auto`/`scroll` que não é
  `html`/`body`/`#root`, criando sua própria caixa de rolagem independente da
  proteção global.
- **Cinto de segurança**: aplicação defensiva de `overflow-x-hidden` num scroller
  aninhado mesmo sem um estouro concretamente reproduzido nele, para prevenir a
  mesma classe de bug independentemente da causa.

## Requisitos (EARS)

### Ubiquitous

- O sistema DEVE quebrar (wrap) qualquer texto de conteúdo não controlado
  renderizado fora do componente `Markdown`, de forma que uma sequência sem
  espaços mais larga que o container quebre em vez de estourar a largura
  disponível.
- O sistema DEVE tratar `overflow-x` explicitamente (`hidden`) em todo scroller
  aninhado (`overflow-y: auto`/`scroll`) que hospede conteúdo de largura
  variável, em vez de deixar o eixo herdar o valor computado `auto` implícito da
  spec de CSS.

### Event-driven

- Quando um resumo ou erro de execução de ferramenta do chat for exibido no
  painel de detalhe expandido, o sistema DEVE quebrar linha em vez de permitir
  que o texto estoure o painel.
- Quando o usuário colar/enviar uma mensagem contendo uma sequência longa sem
  espaços (link, token), o sistema DEVE quebrar essa sequência dentro da própria
  bolha da mensagem.
- Quando uma automação falhar e exibir `errorMessage` no modal de execuções, o
  sistema DEVE quebrar linha em vez de estourar o modal.
- Quando o corpo de uma nota de release (changelog) for exibido — no modal de
  atualização ou na página `/novidades` —, o sistema DEVE quebrar linha em vez de
  estourar o card/modal.

### State-driven

- Enquanto a viewport for estreita (mobile), nenhuma página do app coberta por
  esta spec (todas exceto `/grafo`) DEVE permitir que o usuário arraste o
  conteúdo lateralmente além do necessário para uma rolagem horizontal já
  intencional (ex.: tabelas e blocos de código com scroll-x próprio).

### Optional

- Onde um elemento já tiver um scroller horizontal dedicado e intencional (ex.:
  wrapper de tabela do `Markdown`, bloco `<pre>` de código), o sistema DEVE
  preservar esse scroll horizontal sem aplicar quebra de texto adicional ali.

### Unwanted behavior

- Se `overflow-x-hidden` for aplicado a um scroller como cinto de segurança,
  então o sistema NÃO DEVE alterar o comportamento de rolagem vertical existente
  nem ocultar conteúdo — o texto deve quebrar linha, nunca ser cortado/perdido
  silenciosamente.
- Se a rota for `/grafo` (ou sub-rota), então esta spec NÃO se aplica — fica para
  a frente de trabalho paralela de redesenho mobile daquela página.

## Critérios de Aceite

- [ ] Painel de detalhe de ferramenta no chat (`ToolRow`) quebra linha em
      parâmetros e resumo, mesmo com conteúdo sem espaços.
- [ ] Scroller de mensagens do chat tem `overflow-x-hidden` explícito, além do
      `overflow-y-auto` existente.
- [ ] Bolha da mensagem do próprio usuário no chat quebra linha em texto colado
      sem espaços.
- [ ] `<main>` do shell (`app-layout.tsx`), que hospeda praticamente todas as
      páginas fora do chat/grafo, tem `overflow-x-hidden` no scroller principal.
- [ ] `AlertDescription` (componente base reusado por login, cadastro,
      onboarding, setup e detalhe de job) quebra linha por padrão.
- [ ] `DialogContent` (componente base de modal reusado pelo app) tem
      `overflow-x-hidden` no scroller do conteúdo do modal.
- [ ] Mensagem de erro de execução de automação (`RunsModal`) quebra linha; os
      dois scrollers de modal em `automacoes.tsx` têm `overflow-x-hidden`.
- [ ] Corpo de nota de release quebra linha no modal de atualização
      (`update-modal.tsx`) e na página `/novidades`.
- [ ] Preview de nota vinculada na página de detalhe de transcrição quebra linha.
- [ ] Nenhuma página fora do chat perde rolagem vertical ou funcionalidade
      existente como resultado das mudanças (verificação visual no deploy, já
      que a verificação com Playwright está desabilitada nesta sessão por regra
      explícita do owner).

## Fora de Escopo

- `/grafo` (`apps/web/src/client/pages/grafo.tsx`) — tratado em frente de
  trabalho paralela de redesenho mobile.
- Auditoria exaustiva de 100% dos componentes do app — a varredura cobriu as
  páginas de maior tráfego (chat, biblioteca, notas, automações, admin) e os
  componentes de UI compartilhados (`Dialog`, `Alert`) de forma razoavelmente
  alcançável, não arquivo por arquivo do repositório inteiro.
- Testes automatizados para esta classe de bug — é um bug de CSS/layout sem
  lógica extraível, não testável de forma significativa por unidade sem DOM
  real; verificação é visual.
- Qualquer mudança de comportamento funcional (o fix é puramente visual/layout).

## Riscos / Decisões pendentes

- Alguns dos containers tratados (`app-layout.tsx`, `AlertDescription`,
  `DialogContent`, modal de criar/editar automação) receberam `overflow-x-hidden`
  como cinto de segurança preventivo, sem um estouro concretamente reproduzido
  naquele ponto específico — decisão deliberada de defesa em profundidade dado o
  baixo custo/risco da mudança (aditiva, não remove funcionalidade).
- Verificação visual completa (mobile real, todas as páginas tocadas) fica
  pendente de conferência do owner no ambiente de deploy — esta sessão operou
  com Playwright e subida de Docker desabilitados por regra explícita.
- `transcricoes.tsx`, `admin-usuarios.tsx`, `admin-custos.tsx`,
  `admin-integracoes.tsx`, `transcricoes-detalhe.tsx` (exceto o ponto corrigido) e
  os componentes `fetch-error.tsx`, `model-picker.tsx`, `sidebar.tsx`,
  `mobile-bottom-nav.tsx`, `topbar.tsx`, `notes-tree.tsx`, `markdown-editor.tsx`,
  `jobs-queue-section.tsx`, `content-ingest-card.tsx` e `transcript-viewer.tsx`
  foram auditados e já usavam `truncate`/`break-words`/`break-all`/scroll-x
  dedicado corretamente — nenhuma mudança foi necessária neles.
