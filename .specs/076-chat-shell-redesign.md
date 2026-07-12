# Spec 076 — Redesign do chat + ajustes de shell

## Status

Aprovado pelo owner (2026-07-12).

## Contexto

A UI do chat (`apps/web/src/client/pages/chat.tsx`) era funcional mas fraca: bloco
de ferramentas cru (uma seção por ferramenta), raciocínio pouco expressivo,
composer simples sem upload e cabeçalho local ocupando espaço com botões de sons e
limpar conversa. O objetivo é elevar a UI ao nível "profissional", portando a
linguagem visual de raciocínio/ferramentas do mockup `tool-sim.html` e o composer
do Pulsar, sem quebrar o protocolo de streaming SSE existente com o backend
(`/api/chat`).

Referências:

- Mockup `tool-sim.html` (linguagem visual: toolblock colapsável, linhas de
  ferramenta com ícone por família + status discreto + cronômetro + chevron,
  reasoning com shimmer → "Pensou por Xs", motion `grid-template-rows 0fr↔1fr`).
- Composer do Pulsar (`ChatPanel`): card `focus-within`, textarea Enter/Shift+Enter,
  chips de anexo, controles embaixo, scroller full-width com conteúdo centralizado.
- Spec 074 (harness progressivo): nomes das ferramentas do agente in-app.
- Infra de upload existente: `lib/upload.ts` (`uploadMedia`) → `/api/jobs/upload`.

## Glossário

- **Toolblock**: agrupamento visual de todas as ferramentas de uma resposta do
  assistente. Enquanto roda: "Trabalhando" + spinner + contador N/total. Ao
  terminar: header-resumo ("N ações", famílias, duração) clicável que recolhe/expande.
- **Família de ferramenta**: categoria visual derivada do `tool.name` (busca,
  leitura, notas, brain, transcrição, web) que define ícone e rótulo.
- **Reasoning**: stream de raciocínio do modelo (evento SSE `reasoning`), com
  shimmer "Pensando" enquanto flui e colapsável "Pensou por Xs" ao terminar.
- **Rail**: barra vertical fina de ícones exibida quando a sidebar está colapsada
  na rota de chat (desktop), com tooltip por item e botão de expandir.

## Requisitos

### Ubiquitous

- The system shall preservar o protocolo de streaming SSE do chat (eventos
  `text`, `reasoning`, `tool`, `status`, `compaction`, `usage`, `error`, `done`),
  o `send`, `approve`, `clearHistory`, `refresh` e a lógica de near-bottom.
- The system shall usar exclusivamente tokens de tema (`--color-app-*`,
  `--color-accent-*`) — sem cores hard-coded — funcionando em zinc, emerald e light.
- The system shall respeitar `prefers-reduced-motion` em todas as animações novas.
- The system shall manter as ferramentas de recuperação read-only (o upload apenas
  enfileira conteúdo no acervo via infra existente, sem novo backend).

### Event-driven

- When o chat carrega com histórico, the system shall posicionar o scroller no
  fim antes do paint (via `useLayoutEffect`, `behavior: 'auto'`) — sem animação de
  rolagem do topo ao fim.
- When o assistente executa ferramentas, the system shall agrupá-las num toolblock:
  enquanto há ferramenta em execução mostra "Trabalhando" + spinner + N/total;
  quando todas terminam, colapsa para header-resumo com contagem de ações, famílias
  e duração total, mantendo o conteúdo (fala/resposta) visível.
- When o usuário clica no header do toolblock concluído, the system shall
  recolher/expandir a timeline de ferramentas.
- When o usuário clica numa linha de ferramenta expansível, the system shall
  mostrar/esconder o detalhe (parâmetros seguros / resumo do resultado).
- When o modelo emite raciocínio, the system shall exibir shimmer "Pensando" em
  tempo real e, ao terminar, um botão colapsável "Pensou por Xs" com o texto atrás
  de borda-esquerda.
- When o usuário anexa um arquivo no composer, the system shall enviá-lo via
  `uploadMedia` (`/api/jobs/upload`), exibir um chip com nome truncado + estado
  (enviando/ok/erro) e toast de sucesso/erro, deixando o conteúdo entrar no acervo.
- When a sidebar está colapsada na rota de chat (desktop), the system shall exibir
  um rail vertical de ícones dos itens de navegação (exceto "Início") com tooltip
  no hover e um botão no topo para expandir a sidebar completa.
- When o usuário está em `/chat` (ou `/` no desktop), the system shall renderizar
  os botões de sons e limpar conversa no cabeçalho global (`topbar`), ao lado do
  avatar; fora dessas rotas eles não aparecem.

### State-driven

- While uma resposta está em streaming, the system shall desabilitar o botão de
  limpar conversa e refletir o estado de streaming no cabeçalho global.
- While o composer está vazio e não há mensagens, the system shall centralizar o
  composer na tela (empty state) com a saudação.
- While a sidebar abre/fecha, the system shall recentralizar o conteúdo do chat
  (largura fluida `mx-auto max-w`, barra de rolagem na borda do main).

### Optional

- Where o arquivo anexado não for de um tipo suportado (imagem/mídia/documento),
  the system shall recusar no cliente com mensagem inline antes de enviar.

### Unwanted behavior

- If o upload falhar, then the system shall exibir erro no chip e toast, sem
  derrubar o composer nem perder o texto digitado.
- If o item "Início" for removido da sidebar/rail desktop, then the system shall
  mantê-lo na navegação mobile (bottom-nav) — a remoção é só na sidebar/rail
  desktop, pois no desktop `/` já É o chat (redundância).

## Decisão sobre o item "Início"

`NAV` (em `sidebar.tsx`) é fonte única compartilhada com a bottom-nav mobile
(`mobile-nav.ts` / `mobile-bottom-nav.tsx`). Remover `/` de `NAV` quebraria a aba
raiz do mobile. Decisão: manter `/` em `NAV` e **filtrar o item `/` apenas na
sidebar/rail desktop** (o desktop `/` já renderiza o chat, tornando "Início"
redundante ali). O mobile continua com a aba raiz intacta.

## Critérios de Aceite

- [ ] Chat reescrito preservando o protocolo SSE e as funções de streaming.
- [ ] Toolblock colapsável com linhas por família, status discreto, cronômetro e
      detalhe expansível; reasoning com shimmer → "Pensou por Xs".
- [ ] Composer estilo Pulsar com upload (`/api/jobs/upload`), chips de anexo com
      estado e toasts; centralizado no empty state.
- [ ] Scroller full-width (barra na borda) com conteúdo centralizado que
      recentraliza ao abrir/fechar a sidebar; abre no fim sem animação.
- [ ] Botões de sons e limpar conversa movidos para o `topbar` (só em chat).
- [ ] Rail de ícones na sidebar colapsada em chat (desktop) com tooltip e expandir.
- [ ] Item "Início" some da sidebar/rail desktop; mobile intacto.
- [ ] Store `chat-shell-state.ts` (padrão de `sidebar-state.ts`) publica
      streaming/isEmpty/sounds e o signal de clear.
- [ ] Funções puras novas (map tool→família/ícone/label, formatação de duração,
      detecção de kind de anexo, resumo de famílias) com testes unitários.
- [ ] Strings novas em PT-BR e EN no i18n.
- [ ] Lint, typecheck e testes TS passam (sem Docker/Playwright nesta entrega).

## Fora de Escopo

- Auditoria geral de temas (outra PR) — aqui só garantir chat/shell corretos nos 3.
- Mudanças no backend do chat / protocolo SSE / ferramentas do agente.
- Seleção de modelo, indicador de contexto e de gasto no composer (features do
  Pulsar não portadas por não existirem no fluxo atual do Voxen).
