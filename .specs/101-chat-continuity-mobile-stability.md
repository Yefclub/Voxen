# Spec 101 — Continuidade do chat e estabilidade mobile

## Contexto

O chat pode permanecer indefinidamente em carregamento quando a linha do tempo canônica cresce e pode perder a continuação de uma resposta longa quando a conexão do PWA é interrompida durante a ingestão de um link. A transcrição termina, mas o turno não produz a resposta final esperada.

A experiência também precisa manter navegação, controles e conteúdo utilizáveis em telas móveis pequenas, respeitando teclado virtual e áreas seguras. O grafo não pode tentar focar um nó que já saiu da topologia renderizada.

## Glossário

- **Turno durável**: envio do usuário e resposta correspondente registrados antes do processamento assíncrono.
- **Linha do tempo canônica**: conversa única e persistente do workspace.
- **Área segura**: região da tela que não é coberta por notch, home indicator ou chrome do sistema.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall preservar uma única linha do tempo canônica por workspace sem carregar mensagens compactadas que não são exibidas.
- The system shall registrar o estado de cada turno durável antes de iniciar a geração da resposta.
- The system shall manter a resposta em processamento independente da conexão HTTP aberta pelo cliente.
- The system shall limitar a carga inicial do chat às 60 mensagens ativas mais recentes e oferecer acesso paginado ao histórico anterior.
- The system shall manter todas as rotas utilizáveis em uma viewport de 360 x 640 pixels sem rolagem horizontal da página.
- The system shall respeitar as áreas seguras superior e inferior nos controles fixos do PWA.

### Event-driven (resposta a evento)

- When o usuário enviar uma mensagem, the system shall persistir a mensagem, a resposta pendente e o turno antes de iniciar o processamento.
- When uma ferramenta concluir a transcrição de um link, the system shall continuar o mesmo turno até persistir uma resposta final ou um erro final legível.
- When o cliente voltar ao chat durante um turno ativo, the system shall restaurar o estado pendente e acompanhar a conclusão sem criar outro turno.
- When o usuário solicitar o histórico anterior, the system shall acrescentar a página anterior sem perder a posição visual atual.
- When a topologia do grafo mudar antes do enquadramento da câmera, the system shall focar somente nós ainda presentes na renderização atual.
- When o teclado virtual alterar a viewport, the system shall manter o composer e a ação primária acessíveis.

### State-driven (durante um estado)

- While um turno estiver pendente ou em execução, the system shall exibir um estado de progresso recuperável após navegação, recarga ou retorno do PWA.
- While uma transcrição longa estiver em execução, the system shall renovar a posse exclusiva do turno para impedir processamentos concorrentes.
- While uma tela móvel tiver controles inferiores fixos, the system shall reservar espaço de conteúdo suficiente para que o último item não fique coberto.

### Optional (feature opcional)

- Where o usuário cancelar explicitamente um turno, the system shall interromper o processamento, persistir o cancelamento e liberar o chat para um novo envio.

### Unwanted behavior (condições de erro)

- If a conexão do cliente for encerrada durante a resposta, then the system shall continuar o turno no servidor e permitir que o cliente recupere o resultado depois.
- If o processo da aplicação reiniciar durante um turno, then the system shall retomar o turno pendente após o vencimento da posse anterior sem duplicar mensagens.
- If a ferramenta retornar erro, then the system shall persistir uma resposta final legível e nunca deixar uma ferramenta ou o chat em estado de execução infinito.
- If o serviço de coordenação estiver indisponível, then the system shall rejeitar o início de um turno com erro recuperável em vez de executar concorrentemente.
- If um cursor de histórico for inválido, then the system shall rejeitar a paginação sem afetar a página de mensagens já exibida.
- If o nó solicitado para foco não existir mais, then the system shall ignorá-lo sem lançar erro no navegador.

## Critérios de Aceite

- [ ] O carregamento inicial retorna no máximo 60 mensagens ativas e informa se há histórico anterior.
- [ ] O histórico anterior pode ser carregado e anexado sem duplicatas.
- [ ] Um turno sobrevive ao encerramento da conexão do cliente e termina com resposta persistida.
- [ ] Um turno interrompido por reinício é retomado uma única vez.
- [ ] Uma URL cuja transcrição termine produz resposta final no mesmo turno.
- [ ] Erros e cancelamentos encerram o estado de progresso e liberam um novo envio.
- [ ] O PWA restaura um turno ativo após recarga ou retorno do background.
- [ ] As rotas autenticadas e públicas não apresentam rolagem horizontal em 360 x 640.
- [ ] Com o teclado virtual aberto, o composer continua alcançável.
- [ ] Controles fixos e o último conteúdo respeitam as áreas seguras.
- [ ] O grafo não registra erro ao tentar focar um nó removido durante atualização da topologia.
- [ ] Testes de unidade e integração cobrem paginação, recuperação, concorrência, cancelamento e foco do grafo.

## Fora de Escopo

- Criar múltiplas conversas por usuário.
- Substituir o modelo de IA ou o provedor configurado.
- Alterar o pipeline de extração de áudio e geração da transcrição.
- Redesenhar a identidade visual da aplicação.

## Riscos / Decisões pendentes

- A retomada pode repetir uma chamada externa que terminou sem persistir o resultado; a persistência e a posse exclusiva devem impedir mensagens duplicadas.
- A paginação precisa preservar a ordem estável mesmo quando uma nova resposta chega durante a leitura do histórico.

> 2026-07-16: requisitos consolidados a partir do pedido explícito do usuário para concluir a correção profunda de estabilidade, continuidade do chat, PWA mobile e grafo.
