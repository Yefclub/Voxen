# 125 — Extensão: estado persistente, acabamento visual e ícone

## Contexto

A spec 122 (PR #494) portou a extensão para a identidade visual do Voxen
(tokens, tema herdado da instância, superfície de conexão única). Com ela
em uso real, apareceram quatro problemas — três de acabamento e um
funcional:

1. **Estado do job se perde ao fechar o popup.** No MV3, clicar fora do
   popup destrói o documento inteiro; todo estado em memória morre. O
   `popup.js` inicia um poll (`startPopupPoll`) mas não persiste qual job
   está em andamento, e o `load()` não recupera nada ao reabrir. O usuário
   envia uma página, fecha o popup sem querer, reabre e vê a tela inicial —
   como se nada tivesse acontecido, mesmo com a transcrição rodando. A
   informação já existe: o `background.js` recebe `track-job` e rastreia o
   job para notificar; o popup só não lê isso de volta.
2. **Popup com cantos pouco arredondados** para o padrão visual atual de
   extensões.
3. **Página de opções exige rolagem** e o bloco "Avançado (token opcional)"
   fica colado nos controles vizinhos; a página tem densidade e acabamento
   abaixo do resto do produto.
4. **Ícone na barra do Chrome parece pequeno.** Medição do asset atual: a
   arte ocupa 11×16 px do canvas de 16 px (≈69% da largura), com padding
   assimétrico (L2/R3 no 16px, L19/R29 no 128px) — ou seja, além de
   estreita, está descentralizada. Existe fonte de maior resolução
   disponível (`apps/web/public/voxen-512.png`).

## Glossário

- **Job em andamento**: job de ingestão enviado pela extensão que ainda não
  atingiu estado terminal (não está `DONE`/`FAILED`/`CANCELLED`).
- **Área útil do ícone**: proporção do canvas quadrado efetivamente ocupada
  pela arte, descontado o padding transparente.

## Requisitos

### Ubiquitous

- The system shall preservar, fora da memória do documento do popup, a
  identidade do job em andamento enviado pela extensão.
- The system shall exibir toda a superfície de conexão da extensão sem
  exigir rolagem vertical em uma janela de opções de altura típica.

### Event-driven

- When o popup é aberto e existe um job em andamento rastreado, the system
  shall restaurar a exibição de progresso desse job (etapa atual inclusive)
  em vez de mostrar o estado inicial.
- When o job rastreado atinge estado terminal enquanto o popup está
  fechado, the system shall, na próxima abertura do popup, exibir o
  resultado final (sucesso com resumo, ou o erro) em vez de progresso.
- When o usuário abre o popup e não há job em andamento nem resultado
  recente não visto, the system shall exibir o estado inicial normal.

### State-driven

- While um job enviado pela extensão está em andamento, the system shall
  manter a indicação de progresso consistente entre aberturas sucessivas do
  popup.

### Unwanted behavior

- If o job rastreado não puder ser consultado (rede indisponível, instância
  fora do ar), then the system shall indicar que o acompanhamento está
  indisponível no momento, sem descartar o rastreamento nem apresentar o
  job como concluído ou falho.

## Critérios de Aceite

- [ ] Enviar uma página, fechar o popup, reabrir: o progresso do job
      continua visível com a etapa correta.
- [ ] Job termina com o popup fechado: ao reabrir, aparece o resultado
      (sucesso ou erro), não o estado inicial.
- [ ] Teste automatizado cobrindo a persistência/restauração do job em
      andamento (lógica pura, sem depender de browser real).
- [ ] Popup com cantos arredondados coerentes com o padrão visual do
      produto.
- [ ] Página de opções cabe sem rolagem em altura típica, com separação
      visual adequada do bloco "Avançado".
- [ ] Ícone da extensão com área útil e centralização melhoradas,
      regerado a partir da fonte de maior resolução, nos três tamanhos
      declarados no manifesto.
- [ ] Nenhuma capacidade existente perdida; testes da extensão passando no
      CI (o job `Test extension` já existe desde a spec 122).

## Fora de Escopo

- Captura de cookies de plataforma (spec 121).
- Auto-update da extensão / publicação na Chrome Web Store.
- Página web `/extensao` (`apps/web/src/client/pages/extensao.tsx`).
- Empacotar fontes localmente em vez de carregar do Google Fonts —
  melhoria conhecida, entrega separada.

## Riscos / Decisões pendentes

- **Onde persistir o job**: `chrome.storage.local` é o candidato natural
  (o service worker é efêmero e já usa `chrome.storage`), mas o
  `background.js` já mantém rastreamento próprio para notificação —
  preferir reaproveitar essa fonte a criar uma segunda, evitando duas
  verdades sobre o mesmo job.
- **Redesenho do ícone**: melhorar área útil e centralização a partir de
  `voxen-512.png` é ajuste de enquadramento, não redesenho da arte. Se a
  arte em si (coruja em proporção retrato) for o limitante para leitura em
  16 px, isso é decisão de design do owner, fora do alcance desta spec.
