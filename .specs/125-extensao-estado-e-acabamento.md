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
- If o acompanhamento de um job está indisponível, then the system shall
  manter o envio de novas páginas habilitado — não saber o estado do job não
  é o mesmo que estar ocupado.
- If um job rastreado passa do prazo máximo **sem sinal de vida** — sem
  nenhuma consulta em que o servidor o confirme em andamento —, then the
  system shall descartá-lo do rastreamento, para que job irresolvível
  (instância trocada nas opções, job apagado no servidor) não governe o popup
  indefinidamente.
- If o servidor confirma um job rastreado em andamento, then the system shall
  renovar o sinal de vida desse job, de modo que o prazo meça estagnação e
  não tempo de vida absoluto. Prazo absoluto descartaria job legítimo: numa
  fila com backlog (dezenas de vídeos longos à frente), o último estoura o
  prazo parado em `QUEUED` mesmo com o servidor reportando-o vivo a cada
  consulta — e o usuário perde a notificação.
- If uma requisição da extensão à instância não responde dentro do prazo,
  then the system shall abortá-la e tratá-la como falha de acompanhamento
  recuperável. Sem prazo, uma instância que **pendura** em vez de errar
  (proxy de pé com o backend travado, rota com DROP no caminho) trava o botão
  em "Salvo — processando" para sempre: a fase que libera o envio só roda
  depois que a consulta volta.
- If o popup reconhece o desfecho de um job enquanto uma rodada de
  verificação do service worker está em voo, then the system shall descartar
  o desfecho definitivamente — ele não pode ser regravado e reaparecer como
  novidade na abertura seguinte.
- If um envio é enfileirado enquanto uma rodada de verificação está em voo,
  then the system shall preservá-lo no rastreamento.

## Critérios de Aceite

- [ ] Enviar uma página, fechar o popup, reabrir: o progresso do job
      continua visível com a etapa correta.
- [ ] Job termina com o popup fechado: ao reabrir, aparece o resultado
      (sucesso ou erro), não o estado inicial.
- [ ] Teste automatizado cobrindo a persistência/restauração do job em
      andamento (lógica pura, sem depender de browser real).
- [ ] Teste automatizado provando que job rastreado irresolvível (antigo, ou
      apontando para instância que não responde) não deixa o botão de envio
      desabilitado.
- [ ] Testes automatizados dos dois requisitos de concorrência, exercitando o
      `background.js` de verdade com a rede sob controle do teste (dublê de
      `chrome`, `chrome.storage` com semântica de cópia como a real,
      resolução do `fetch` no instante escolhido). Sem isso os requisitos
      ficam sem gate: o modo de falha é corrida intermitente, invisível para
      testes de função pura, e um refactor pode derrubar qualquer um dos três
      mecanismos (lock, releitura pós-rede, filtro do desfecho já
      reconhecido) em silêncio.
- [ ] Teste automatizado provando que job confirmado em andamento pelo
      servidor não é descartado pelo prazo, e que o descarte do zumbi
      continua valendo.
- [ ] Teste automatizado provando que as requisições da extensão têm prazo e
      que estourá-lo vira falha recuperável (não desfecho, não perda de
      rastreamento).
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
