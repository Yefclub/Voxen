# 110 — Carregamento progressivo de rotas

## Contexto

O cliente registra todas as telas no `App.tsx` com imports estáticos. Assim, áreas que são abertas eventualmente — como Grafo, Notas, Automações e Administração — entram no download inicial do chat. Em rede móvel isso adia o primeiro uso e aumenta o cache inicial do PWA sem necessidade.

## Requisitos

- **REQ-1**: Cada tela roteável DEVE ser carregada sob demanda, sem import estático de página em `App.tsx`.
- **REQ-2**: A entrada `/` DEVE continuar mostrando o chat e preservar o redirecionamento de share target para a Biblioteca.
- **REQ-3**: Enquanto uma tela autenticada é carregada, o shell de navegação DEVE permanecer visível e apresentar um estado de carregamento acessível apenas na área de conteúdo.
- **REQ-4**: O carregamento sob demanda NÃO DEVE alterar as rotas, redirecionamentos nem os guards de autenticação e onboarding atuais.
- **REQ-5**: Grafo, editor de notas, renderização de Markdown e áreas administrativas NÃO DEVEM bloquear o primeiro carregamento da rota inicial.

## Fora de escopo

- Alterar os fluxos de navegação, autenticação ou onboarding.
- Alterar a estratégia de cache e atualização do service worker.
- Refatorar componentes internos das telas.

## Critérios de aceite

- O build de produção emite chunks separados para as telas carregadas sob demanda.
- O bundle inicial deixa de incluir a maior parte das telas que não são abertas na rota inicial.
- O fallback de rota mantém o chrome autenticado e expõe `role="status"` com rótulo de carregamento.
- Há teste de contrato para imports dinâmicos e para o fallback, e typecheck, lint, testes focados e build permanecem verdes.
