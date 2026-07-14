# Spec 091 — Polimento visual do chat (markdown, copiar, chrome mobile)

## Contexto

No chat, links e código inline do markdown aparecem com peso visual demais
(faixas verdes/violetas) e competem com o texto da resposta. Falta ação de
copiar mensagem. No mobile, o pill do cabeçalho direito fica maior que o botão
da sidebar e o fundo opaco impede ver o histórico passando por baixo.

## Requisitos

### Ubiquitous

- The system shall render links e código inline do markdown do chat com peso
  visual próximo ao texto do corpo (sem chips saturados).
- The system shall oferecer ação de copiar o texto da mensagem do usuário e da
  assistente.

### State-driven

- While o ponteiro estiver sobre a mensagem (ou o foco estiver nela), the
  system shall exibir o botão de copiar abaixo do conteúdo.
- While a viewport for menor que 768 px na rota de chat, the system shall
  renderizar o cabeçalho direito transparente (sem pill opaca), com controles
  no mesmo alvo 32×32 px do botão da sidebar, e the system shall permitir que
  o histórico role por baixo do chrome mantendo o cabeçalho acima (z-index).

### Unwanted

- If a mensagem estiver vazia (só thinking/tools sem texto), then the system
  shall não exibir botão de copiar.

## Critérios de Aceite

- [x] Inline code/links do chat sem fundo/cor saturada de “badge”
- [x] Botão copiar abaixo de balão do user e resposta da IA
- [x] Topbar mobile: controles 32 px, sem pill elevada opaca
- [x] Histórico do chat mobile passa sob o chrome; chrome permanece por cima
- [ ] Lint/testes verdes (sem Docker/Playwright nesta entrega)

## Fora de Escopo

- Copiar trechos selecionados / share sheet nativo
- Redesign completo do markdown / tabelas
- Playwright e Docker nesta entrega
