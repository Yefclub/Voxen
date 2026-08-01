# 127 — Versionamento de mensagens do chat

## Contexto

Hoje o chat do Voxen é uma lista linear: `ChatMessage` ordenada por
`createdAt`, filtrada por `compactedAt: null`, dentro de uma
`Conversation`. Não há como refazer uma pergunta sem perder o que veio
depois — o usuário reescreve a mensagem no composer e o turno anterior fica
no histórico como ruído, ou ele abre outra conversa e perde o contexto
construído até ali.

O pedido do owner: ao lado do botão de copiar da **mensagem do usuário**,
um botão que permite editar e reenviar aquela mensagem criando uma **nova
trilha** a partir daquele ponto, com as trilhas anteriores preservadas e
navegáveis. É o comportamento que ChatGPT, Claude e Orbital já oferecem.

Isso muda a forma da conversa de **lista** para **árvore**: cada mensagem
passa a ter um antecessor, e a conversa passa a ter uma trilha ativa. Todo
lugar que hoje lê "as mensagens desta conversa" precisa passar a ler "as
mensagens da trilha ativa desta conversa" — incluindo o histórico enviado
ao modelo, a compactação de memória e o snapshot que restaura a UI.

## Glossário

- **Versão**: cada texto alternativo de uma mesma mensagem do usuário,
  criado ao editar e reenviar a partir de um mesmo ponto da conversa.
- **Trilha**: o caminho de mensagens da raiz da conversa até uma folha,
  passando por uma versão escolhida em cada ponto de ramificação.
- **Trilha ativa**: a trilha atualmente exibida e usada como histórico nas
  chamadas ao modelo.
- **Ponto de ramificação**: mensagem do usuário que tem mais de uma versão.

## Requisitos

### Ubiquitous

- The system shall preservar todas as versões de uma mensagem e as
  respostas geradas a partir de cada uma — versionar nunca apaga conteúdo.
- The system shall usar somente as mensagens da trilha ativa como histórico
  enviado ao modelo.
- The system shall manter o isolamento por usuário em toda operação de
  versionamento: versão só pode ser criada, lida ou ativada pelo dono da
  conversa, com o identificador do usuário derivado da sessão.

### Event-driven

- When o usuário aciona o versionamento em uma mensagem sua, the system
  shall abrir a mensagem para edição com o texto atual carregado.
- When o usuário confirma o reenvio de uma mensagem editada, the system
  shall criar uma nova versão daquela mensagem, torná-la a trilha ativa e
  gerar a resposta do assistente nessa nova trilha.
- When uma mensagem do usuário tem mais de uma versão, the system shall
  exibir um indicador de navegação entre versões junto dela.
- When o usuário navega para outra versão, the system shall exibir a trilha
  correspondente àquela versão a partir daquele ponto, sem gerar nova
  resposta.
- When o usuário envia uma mensagem nova estando em uma trilha, the system
  shall anexá-la ao fim da trilha ativa.

### State-driven

- While uma resposta está sendo gerada, the system shall impedir o
  versionamento e a troca de trilha naquela conversa.

### Unwanted behavior

- If o usuário confirma o reenvio sem alterar o texto, then the system
  shall ainda assim criar uma versão nova — reenviar o mesmo texto é um uso
  legítimo (tentar outra resposta do modelo).
- If a geração da resposta da nova versão falhar, then the system shall
  manter a versão criada e a trilha ativa nela, com o erro visível e a
  possibilidade de tentar de novo — sem reverter em silêncio para a trilha
  anterior.
- If a conversa tem mensagens anteriores ao versionamento (sem antecessor
  registrado), then the system shall tratá-las como uma trilha única e
  contínua, sem exigir migração de dados nem exibir indicador de versão.

## Entrega em duas partes

A feature foi fatiada porque a parte de risco — reescrever TODAS as leituras
de histórico — precisa ser revisável sozinha. Misturada com a UI, ela vira
ruído no diff, e é justamente ela que, errada, vaza contexto em silêncio.

- **Parte 1 (esta)** — modelo de dados, resolução da trilha, todas as leituras
  corrigidas, endpoints de criar versão e trocar de trilha, testes. Sem UI: os
  endpoints existem mas nenhuma tela os chama ainda, e o comportamento visível
  do chat é idêntico ao de antes.
- **Parte 2** — botão ao lado do copiar, edição embutida, indicador `‹ n/N ›`
  e navegação entre versões em `apps/web/src/client/pages/chat.tsx`.

## Critérios de Aceite

Parte 1:

- [x] O histórico enviado ao modelo contém apenas a trilha ativa —
      verificado por teste, não por inspeção visual.
- [x] Conversas criadas antes desta feature continuam funcionando sem
      migração de dados e sem indicador de versão.
- [x] Compactação de memória continua correta em conversa ramificada.
- [x] Isolamento por usuário coberto por teste comportamental: versão de
      outra conversa/usuário não pode ser lida nem ativada.
- [x] Migration idempotente, aditiva e sincronizada com o schema.
- [x] Reenviar cria versão nova, gera resposta e a trilha nova passa a ser a
      ativa (endpoint `POST /api/chat/messages/:id/versions`).
- [x] Trocar de trilha não gera resposta nova
      (endpoint `POST /api/chat/messages/:id/activate`).
- [x] Recarregar mantém a trilha ativa: o ponteiro vive na conversa, não no
      cliente.
- [x] O snapshot expõe posição e total das versões só em ponto de
      ramificação, para a Parte 2 renderizar.

Parte 2:

- [x] Botão de versionar ao lado do copiar, apenas em mensagens do usuário.
- [x] Editar abre a mensagem com o texto atual carregado.
- [x] Indicador `‹ n/N ›` presente em ponto de ramificação, navegando entre
      versões. (Desde a spec 130 ele se revela no hover da mensagem, junto das
      demais ações, em vez de ficar sempre visível.)
- [x] Versionamento e troca de trilha bloqueados na UI enquanto uma resposta
      está sendo gerada (o servidor já recusa com 409).

## Fora de Escopo

- Editar mensagem do **assistente**.
- Regenerar resposta sem editar a pergunta (botão "tentar de novo" na
  mensagem do assistente) — feature vizinha, entrega separada.
- Visualização em árvore/diagrama das trilhas; a navegação é linear
  (‹ n/N ›) dentro de cada ponto de ramificação.
- Comparar versões lado a lado.
- Versionamento nas notas ou em qualquer superfície fora do chat.

## Decisões

- **Modelo de dados: `ChatMessage.parentId` + `Conversation.activeLeafId`.**
  A trilha é a caminhada da folha ativa até a raiz, invertida. Alternativas
  descartadas: uma `Conversation` por ramo esbarra em `userId @unique` (o
  sistema inteiro assume uma conversa por workspace); uma tabela de versões
  em separado duplicaria a linha do tempo e deixaria duas fontes de verdade
  sobre "o que veio antes".

- **Resolução centralizada, com todas as leituras passando por ela.** A
  ordem mora em `message-trail.ts` (puro) e `conversation-trail.ts` (fala com
  o banco). As leituras reescritas: snapshot da UI, cursor de paginação,
  histórico enviado ao modelo, compactação, reconciliação de HITL e a
  recuperação de turno órfão — esta última não estava no levantamento
  inicial e usava "última mensagem por `createdAt`", que numa árvore pode
  estar num ramo abandonado.

- **Ordem das operações na leitura.** A caminhada roda sobre TODAS as
  mensagens, inclusive as compactadas, e só depois filtra por `compactedAt`.
  Filtrar antes quebra a corrente de antecessores no ponto compactado e a
  trilha termina cedo, escondendo o histórico recente.

- **Compactação percorre só a trilha ativa**, e o resumo entra COMO NÓ da
  trilha: nasce filho da última mensagem compactada, e todos os outros filhos
  dela são reparentados para o resumo. Assim a caminhada passa naturalmente
  pelo resumo, os compactados continuam como ancestrais filtrados, e versões
  que eram irmãs continuam irmãs (reparentar só a trilha ativa apagaria o
  indicador de versão daquele ponto).

- **Compatibilidade sem migração de dados.** Mensagem sem antecessor é lida
  como prefixo linear contínuo: se a caminhada termina numa raiz sem
  antecessor, tudo que também não tem antecessor e é mais antigo entra antes.
  Conversa antiga aparece inteira e sem indicador de versão.

- **Encadeamento preguiçoso, não backfill de deploy.** Na primeira escrita
  estrutural de uma conversa (novo turno, nova versão, troca de trilha,
  compactação), as mensagens sem antecessor são encadeadas em ordem de criação
  e a conversa é marcada com `messagesLinearized`. É idempotente, por conversa,
  e vira no-op depois. A migration continua puramente aditiva; a conversa que
  ninguém abre nunca é tocada.

- **A marca `messagesLinearized` é explícita, não inferida.** A tentação era
  deduzir "isto já é uma árvore" contando quantas mensagens estão sem
  antecessor. Não funciona: versionar a PRIMEIRA mensagem cria uma segunda
  raiz legítima, e a inferência leria isso como acervo antigo — prependendo a
  versão abandonada no histórico enviado ao modelo (duas perguntas do usuário
  seguidas). Com a marca, "sem antecessor" só é ambíguo em conversa não
  encadeada, e a raiz pode ter versões como qualquer outro ponto.

- **Antecessor da versão é resolvido dentro da transação do turno**, depois do
  encadeamento — não lido na rota. Em conversa do acervo antigo o antecessor só
  passa a existir depois de encadear; lê-lo antes devolve nulo e faz a versão
  nascer como segunda raiz, jogando fora o histórico anterior a ela.

- **O bloqueio durante a geração é a própria escrita.** Trocar de trilha usa um
  update condicional (`thinking: false`) em vez de ler e depois gravar: entre
  as duas operações um turno poderia reivindicar a conversa e acabar montando
  o prompt do ramo errado.

### Parte 2 (UI)

- ~~**Indicador sempre visível, ações no hover.**~~ **REVOGADA pela spec 130,
  item 4.** A decisão original era: a linha de ações da mensagem do usuário já
  revela copiar só no hover e o botão de editar entra nessa mesma regra, mas o
  `‹ n/N ›` não, porque ele é *estado* ("você está lendo a 2ª de 3 respostas") e
  estado que some quando o ponteiro sai da mensagem esconderia do usuário
  justamente o fato de ele estar numa trilha antiga.

  Em uso real o owner pediu o contrário — *"o 2/2 de versionamento não está
  ficando invisível como os outros botões ao passar o mouse sobre a mensagem"*
  —, priorizando a linha limpa em repouso e a paridade visual entre tudo o que
  pertence à mensagem. A decisão é dele. Desde a 130 o indicador usa o mesmo
  `ACTION_REVEAL` do copiar e do editar; a revelação continua sendo por
  opacidade, então as setas seguem na ordem de tabulação e voltam a aparecer no
  `focus-within` do grupo.

- **Reenviar recorta a trilha na hora.** A versão nova nasce IRMÃ da mensagem
  editada, então a mensagem editada e tudo depois dela não pertencem à trilha
  nova — e o snapshot seguinte não as traz de volta, porque a mesclagem de
  páginas preserva o que já está no cliente. Sem o corte otimista, as duas
  versões da mesma pergunta ficam empilhadas na tela.

- **Trocar de trilha substitui o snapshot em vez de mesclar.** Duas trilhas só
  compartilham o prefixo até o ponto de ramificação; mesclar deixaria o ramo
  abandonado na tela junto com o escolhido.

- **A versão herda os anexos da mensagem editada**, e o reenvio não consome os
  arquivos preparados no composer. O servidor re-vincula os mesmos jobs com
  escopo de workspace, então editar uma pergunta não perde em silêncio o PDF
  que a acompanhava nem anexa por engano o arquivo da próxima mensagem.

- **Bloqueio na UI duplica o 409 do servidor de propósito.** Oferecer o botão
  para depois falhar é pior do que não oferecer, e o guarda vive no handler
  (não só no atributo `disabled`) para que disparo programático também pare.
  Mesma regra cobre mensagem ainda não persistida (bolha otimista `local-*`),
  que versionada iria para um 404.

- **O rascunho da edição vive no formulário**, inicializado com o texto atual
  da mensagem. A página guarda só o id em edição — não há rascunho para
  sincronizar com id, e o critério "abre com o texto atual carregado" fica
  exercitável por teste de render.

- **O corte otimista só é desfeito enquanto a versão não existe**, e o sinal é
  a ACEITAÇÃO do POST, não o evento `start` do stream. A rota cria o turno
  antes de abrir o stream, então um 2xx já significa versão gravada e trilha
  ativa trocada; entre o 2xx e o primeiro frame há uma janela em que usar
  `start` restauraria indevidamente. Com a versão criada, desfazer é pior que
  não desfazer: as bolhas otimistas deixam de ser descartáveis assim que
  `reconcileChatStart` troca os ids `local-*` pelos reais, e a união com a
  lista pré-corte empilharia as duas versões da mesma pergunta na tela.
  Prefixo + versão nova é incompleto, mas correto — o reload traz o resto.

- **Recuperação de falha no reenvio substitui o snapshot em vez de mesclar.**
  Ali não dá para saber se a versão foi criada: se foi, mesclar traz a
  mensagem editada de volta ao lado da versão nova; se não foi, mesclar com o
  prefixo cortado abre um buraco, porque o snapshot é uma janela de 60
  mensagens da trilha e não a trilha inteira. Substituir acerta nos dois
  casos, ao custo de re-paginar o histórico já carregado.

## Riscos aceitos

- **Snapshot lê os nós da conversa inteira** (projeção leve: id, antecessor,
  papel, tipo, datas) para poder recortar a caminhada, no lugar do cursor por
  `createdAt` de antes. Numa árvore não há como paginar por data sem antes
  saber qual é a trilha. Ainda é menos tráfego que a compactação já fazia (ela
  lia conteúdo completo sem limite). Se virar problema, o caminho é uma CTE
  recursiva de `activeLeafId` para cima.
- **A cola de `ChatPage` não tem teste automatizado.** O que decide sozinho
  (navegação entre versões, corte da trilha, rollback do corte, endpoint,
  herança de anexos, consumo do composer) foi extraído para
  `client/lib/chat-versions.ts` e é coberto por teste comportamental; os
  controles vivem em `components/chat/message-versioning.tsx` e são cobertos
  por render. Sobra o fio que liga os dois dentro de `chat.tsx` — o guarda de
  `send` durante a troca de trilha e o `busy` do composer — verificado por
  inspeção e por simulação contra as funções reais, não por teste. Fechar isso
  exige um harness de `ChatPage` (sessão, roteador, i18n, `fetch`), que não
  existe no repo e é entrega própria.

- **A folha ativa não tem chave estrangeira.** `Conversation.activeLeafId`
  apontando para `ChatMessage` fecharia um ciclo de relação no Prisma. Em
  troca: ponteiro pendurado cai na última mensagem, e `clearConversation` zera
  o ponteiro na mesma transação que apaga as mensagens.
