# Spec 112 — Estabilidade do runtime e da interface do chat

## Contexto

O chat apresenta quatro falhas relacionadas ao mesmo contrato de execução: o estado inicial
afirma que a biblioteca está sendo consultada mesmo quando a solicitação não é uma busca; o
tempo exibido ignora o trabalho anterior ao primeiro segmento de raciocínio; identificadores de
aprovação aceitos pelo runtime podem ser recusados pela rota de confirmação; e a reconciliação
por snapshot recria estado visual e dispara rolagens mesmo quando a conversa não mudou.

Esses comportamentos prejudicam a confiança no agente: uma ação válida parece inválida, o tempo
percebido não corresponde ao informado e a interface muda de posição durante a execução. Esta
spec unifica o contrato visível do turno sem alterar a política de HITL nem o conteúdo privado do
raciocínio.

## Glossário

- **Turno**: execução iniciada por uma mensagem do usuário e encerrada por resposta, erro,
  cancelamento ou pausa HITL.
- **Estado operacional**: texto curto e sanitizado que descreve a fase atual do turno.
- **Snapshot**: representação persistida da conversa usada em carga, recuperação e reconexão.
- **Identidade visual**: chave estável de uma mensagem usada pelo React para preservar o
  componente entre stream e snapshot.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall aceitar identificadores HITL opacos, não vazios e limitados, sem exigir que
  tenham formato UUID nem normalizar seus bytes.
- The system shall validar a propriedade da aprovação pelo usuário e manter a execução da ação
  idempotente.
- The system shall armazenar a identidade emitida pelo provider sob chave única composta pelo
  usuário, permitindo o mesmo identificador em workspaces diferentes sem colisão.
- The system shall usar estados operacionais que descrevam a fase real sem afirmar que houve
  busca na biblioteca em todo turno.
- The system shall calcular a duração apresentada desde o início conhecido do turno até o fim do
  último segmento de raciocínio.
- The system shall preservar referências de mensagens e do turno ativo quando um snapshot
  semanticamente idêntico for recebido.

### Event-driven (resposta a evento)

- When o servidor iniciar a compactação do contexto, the system shall informar que a memória da
  conversa está sendo organizada.
- When o servidor preparar referências e configurações independentes, the system shall
  executá-las concorrentemente antes da chamada ao modelo.
- When o servidor aceitar um turno, the system shall enviar ao cliente as identidades
  persistentes das mensagens e o instante de início.
- When o cliente receber as identidades persistentes, the system shall substituir as identidades
  locais antes da reconciliação final para evitar remontagem visual.
- When o usuário confirmar uma ação HITL, the system shall desabilitar novas confirmações da
  mesma ação até a resposta da API.

### State-driven (durante um estado)

- While o turno estiver em streaming, the system shall manter o bloco de raciocínio aberto.
- While a recuperação por snapshot estiver ativa, the system shall não re-renderizar a conversa
  se mensagens e turno ativo não mudaram semanticamente.
- While a rolagem automática acompanhar o crescimento da resposta, the system shall usar
  deslocamento imediato; animação suave shall ser reservada a uma ação explícita do usuário.

### Unwanted behavior (condições de erro)

- If um identificador HITL estiver vazio ou exceder o limite aceito, then the system shall
  recusar a confirmação sem efeito colateral.
- If uma confirmação for repetida enquanto a primeira ainda estiver em andamento, then the
  system shall ignorar a repetição no cliente.
- If um snapshot substituir mensagens locais por mensagens persistidas equivalentes, then the
  system shall não remontar o bloco de raciocínio nem disparar uma rolagem animada.

## Critérios de Aceite

- [ ] A rota de aprovação aceita um identificador opaco não-UUID emitido pelo runtime.
- [ ] Identificadores HITL vazios ou acima do limite são recusados.
- [ ] Testes de aprovação cobrem identificador opaco e preservam execução única por usuário.
- [ ] Testes cobrem o mesmo identificador opaco em dois usuários sem cruzar payloads ou notas.
- [ ] O estado inicial não afirma “Buscando na sua biblioteca…” em todo turno.
- [ ] Compactação e preparação do contexto emitem estados operacionais coerentes.
- [ ] Pré-busca e leitura de configuração independente são aguardadas em paralelo.
- [ ] A duração do pensamento inclui o intervalo anterior ao primeiro delta de raciocínio.
- [ ] O evento inicial estabiliza as chaves das mensagens local e persistida.
- [ ] Snapshots semanticamente iguais preservam o array e os objetos existentes.
- [ ] Polling sem mudança não substitui o objeto do turno ativo.
- [ ] Confirmação HITL fica desabilitada enquanto a requisição está em andamento.
- [ ] Rolagem automática de acompanhamento não usa animação suave.
- [ ] Lint, formatação, tipos, testes e build permitidos ficam verdes sem Docker ou Playwright.

## Fora de Escopo

- Alterar o modelo de IA ou o esforço de raciocínio configurado.
- Expor cadeia de pensamento, prompts internos ou dados brutos de ferramentas.
- Redesenhar visualmente o chat ou mudar a política de pausa estrutural do HITL.
- Subir Docker, executar Playwright ou modificar infraestrutura de deploy.
- Criar telemetria externa ou um novo sistema de observabilidade.

## Riscos / Decisões pendentes

- Comparar snapshots exige serializar apenas os campos estruturados que podem mudar; a
  preservação de referência não pode esconder atualizações reais de conteúdo, ferramentas ou
  segmentos.
- O identificador HITL continua tratado como dado opaco e escopado pelo usuário; aceitar formato
  não-UUID não reduz as verificações de autorização e uso único.
- O instante enviado pelo servidor é a fonte principal; o instante local permanece como fallback
  para o intervalo anterior à primeira resposta de transporte.

> 2026-07-28: escopo aprovado pelo owner a partir da auditoria dos prints e do fluxo atual do chat.
