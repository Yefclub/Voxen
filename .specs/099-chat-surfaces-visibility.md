# Spec 099 — Visibilidade das superfícies de conversa

## Status

Aprovado pelo owner em 2026-07-15.

## Contexto

O chat usa o mesmo estado para controlar o acompanhamento automático do fim do
histórico e a visibilidade da ação “Ir ao mais recente”. A âncora programática de
uma mensagem recém-enviada desativa temporariamente esse acompanhamento, fazendo
a ação aparecer em uma conversa nova ou enquanto o agente apenas pensa, mesmo sem
o usuário ter rolado o histórico.

No detalhe de uma transcrição, a barra contextual de conversa permanece totalmente
aberta e ocupa altura excessiva sobre o conteúdo. Ela deve funcionar como um dock
compacto: uma faixa do card continua visível para descoberta e o campo aparece sob
interação intencional, sem perder acessibilidade nem o fluxo de envio existente.

## Glossário

- **Afastamento deliberado**: rolagem não programática do usuário que deixa o
  histórico pelo menos 96 px distante do fim.
- **Faixa do dock**: porção sempre visível e acionável do card contextual quando o
  compositor está recolhido.
- **Compositor**: campo contextual e ação de envio no detalhe da transcrição.

## Requisitos

### Ubiquitous

- The system shall separar o estado de acompanhamento automático do histórico do
  estado que autoriza exibir a ação “Ir ao mais recente”.
- The system shall manter o texto digitado e o comportamento de envio contextual
  da transcrição durante expansões e recolhimentos do dock.
- The system shall manter a faixa recolhida do dock operável por teclado e com o
  estado expandido exposto às tecnologias assistivas.

### Event-driven

- When o usuário rolar deliberadamente o histórico para pelo menos 96 px longe do
  fim, the system shall exibir a ação “Ir ao mais recente”.
- When o usuário acionar “Ir ao mais recente”, the system shall ocultar a ação
  imediatamente e retornar suavemente ao fim sem reaparecer durante o deslocamento
  programático.
- When o ponteiro entrar no dock recolhido, o foco entrar no dock ou o usuário
  acionar sua faixa, the system shall expandir o compositor contextual.
- When o ponteiro sair e o dock não contiver foco nem texto digitado, the system
  shall recolher novamente o compositor.
- When o usuário enviar uma pergunta contextual válida, the system shall preservar
  o handoff existente para o chat canônico com a referência da transcrição.

### State-driven

- While uma conversa for nova ou o agente estiver pensando ou transmitindo sem o
  usuário ter se afastado deliberadamente do fim, the system shall manter a ação
  “Ir ao mais recente” oculta.
- While o dock estiver recolhido, the system shall deixar visível uma faixa
  acionável de 32 px e manter o restante do card fora da área útil.
- While o dock contiver foco ou texto digitado, the system shall mantê-lo expandido.
- While a preferência de movimento reduzido estiver ativa, the system shall remover
  a animação de expansão e recolhimento do dock.

### Optional

- Where o dispositivo não oferecer hover, the system shall permitir alternar o
  dock pela faixa acionável quando não houver rascunho, sem depender de hover.

### Unwanted behavior

- If uma rolagem for causada pela âncora do envio, crescimento do streaming,
  carregamento inicial ou retorno programático ao fim, then the system shall não
  tratá-la como afastamento deliberado nem exibir “Ir ao mais recente”.
- If o dock perder foco com texto ainda digitado, then the system shall não
  recolhê-lo nem descartar o rascunho.
- If a pergunta contextual estiver vazia, then the system shall manter a ação de
  envio desabilitada e não iniciar o handoff.

## Critérios de Aceite

- [x] A lógica pura de visibilidade diferencia rolagem deliberada, âncora
      programática e retorno ao fim em testes unitários.
- [x] Uma conversa nova e um turno apenas em pensamento/streaming não exibem “Ir ao
      mais recente” sem rolagem deliberada do usuário.
- [x] Rolar deliberadamente para cima exibe o CTA; acioná-lo o oculta até o retorno
      ao fim terminar.
- [x] O dock da transcrição inicia recolhido com uma faixa acionável de 32 px e usa
      uma composição expandida compacta em uma única linha.
- [x] Hover, foco de teclado e toque/clique expandem o dock; texto ou foco impedem
      recolhimento acidental.
- [x] O campo aceita múltiplas linhas, `Enter` envia, `Shift+Enter` quebra linha e o
      botão continua refletindo a validade do rascunho.
- [x] O dock expõe `aria-expanded`, associação com seu conteúdo e transição
      compatível com movimento reduzido.
- [x] Testes focados, lint, typecheck e build web passam sem Docker nem Playwright.

## Fora de Escopo

- Alterar o protocolo SSE, a persistência ou o runtime do agente.
- Criar uma nova sessão de chat para cada transcrição.
- Adicionar novos tipos de anexo ao compositor contextual.
- Alterar a âncora visual da mensagem recém-enviada definida na spec 092.
- Testes Playwright ou execução local de Docker, conforme restrição do owner.

## Riscos / Decisões pendentes

- A faixa de 32 px equilibra descoberta e área liberada sobre o conteúdo; pode ser
  refinada após uso real sem mudar o contrato de interação.
- O dock permanece expandido enquanto houver rascunho para evitar esconder uma
  edição em andamento; sem rascunho, ele recolhe quando ponteiro e foco saem ou,
  em dispositivos sem hover, quando a faixa for acionada novamente.

> 2026-07-15: em dispositivos sem hover, a faixa alterna o dock vazio; com rascunho,
> o card permanece aberto para não esconder nem perder uma edição em andamento.
