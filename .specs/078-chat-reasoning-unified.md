# Spec 078 — Raciocínio corrigido e unificado com as ferramentas

## Status

Implementado nesta entrega (2026-07-12).

## Contexto

A spec 076 introduziu o `ToolBlock` (ferramentas) e o `ReasoningBlock` (raciocínio)
atuais do chat — dois containers colapsáveis independentes, sempre renderizados na
mesma ordem fixa (raciocínio em cima, ferramentas embaixo). A spec 074 (#351)
trouxe o harness progressivo: o agente roda até 12 steps intercalando raciocínio
e chamadas de ferramenta (raciocina → busca → raciocina de novo → lê → ...). Dois
problemas surgiram desse cruzamento:

1. **Backend**: `streamText()` configurava o esforço de raciocínio via `reasoning`
   top-level do AI SDK. Esse parâmetro só é nativamente suportado por
   OpenAI/Anthropic/Google/xAI/Groq/DeepSeek/Fireworks/Bedrock — o OpenRouter (único
   provider do Voxen) não está nessa lista, e o SDK descarta o parâmetro
   silenciosamente (warning) para providers não suportados. Resultado: o raciocínio
   não chegava a ser pedido de forma confiável ao modelo.
2. **Frontend**: a UI guardava `reasoning` (string única) e `tools` (array) como
   campos fixos da mensagem, renderizados sempre na mesma posição. Com raciocínio e
   ferramentas se intercalando ao longo de vários steps, a posição visual nunca
   refletia a ordem real dos eventos — o bloco de raciocínio ficava estático no
   topo enquanto a atividade de fato acontecia (invisível) embaixo.

Esta spec corrige o parâmetro do backend e substitui o modelo de dados fixo por uma
lista cronológica de segments, unificando `ReasoningBlock` + `ToolBlock` num único
bloco de pensamento. Também corrige dois bugs visuais menores encontrados durante a
mesma auditoria (botão "Ir ao mais recente" esticado, ícone de enviar).

## Glossário

- **Segment**: unidade cronológica de um turno do assistente. União discriminada
  `MessageSegment` = `ReasoningSegment | ToolGroupSegment`.
- **ReasoningSegment**: texto de raciocínio acumulado + instante de início e
  (quando fechado) de fim. Nunca persistido — dado somente ao vivo, como antes.
- **ToolGroupSegment**: grupo de 1+ ferramentas que chegaram consecutivamente, sem
  raciocínio entre elas.
- **Bloco de pensamento**: componente único que substitui `ReasoningBlock` +
  `ToolBlock`, renderizando os segments na ordem real de chegada.

## Requisitos

### Ubiquitous

- The system shall configurar o esforço de raciocínio no formato aceito pelo único
  provider suportado pelo Voxen (OpenRouter), em vez do formato genérico do SDK que
  é silenciosamente ignorado para esse provider.
- The system shall preservar o protocolo de streaming SSE existente (eventos
  `text`, `reasoning`, `tool`, `status`, `compaction`, `usage`, `error`, `done`) e
  as funções `send`, `approve`, `clearHistory`, `refresh`.
- The system shall manter o raciocínio como dado somente ao vivo — nunca
  persistido em banco (decisão preexistente, inalterada).
- The system shall reaproveitar a linha de ferramenta (ícone por família, expand
  de detalhe, auto-abertura em aprovação pendente) sem alterações de
  comportamento.

### Event-driven

- When o modelo emite um delta de raciocínio, the system shall estender o último
  segmento se ele já for um raciocínio em aberto, ou empilhar um novo segmento de
  raciocínio caso contrário.
- When o agente inicia ou atualiza uma ferramenta, the system shall localizar a
  ferramenta pelo id em todos os grupos já existentes no turno — se encontrada
  (atualização de estado/resultado), atualizá-la no grupo em que está, mesmo que
  não seja o último; se for uma ferramenta nova, encerrar um raciocínio em aberto e
  estender o último segmento (quando já for um grupo de ferramentas) ou empilhar um
  novo grupo.
- When chega o primeiro delta de texto final do turno, the system shall encerrar
  um segmento de raciocínio em aberto, se houver.
- When uma mensagem histórica (recarregada da API, sem streaming ao vivo) tem
  ferramentas persistidas, the system shall construir um único grupo de
  ferramentas na ordem persistida, sem segmento de raciocínio.
- When o usuário clica no cabeçalho do bloco de pensamento já concluído, the
  system shall recolher ou expandir os segments.

### State-driven

- While qualquer segmento do turno estiver em andamento — raciocínio sem fim
  marcado, ou ferramenta em execução/aguardando aprovação, em qualquer grupo — the
  system shall exibir o cabeçalho do bloco de pensamento como "Pensando" (efeito
  de shimmer).
- While o bloco de pensamento não estiver em andamento, the system shall exibir
  "Pensou por Xs" com a duração de parede acumulada desde o primeiro evento do
  turno até o fim — somente em turnos ao vivo; mensagens recarregadas não exibem
  duração.
- While o botão "Ir ao mais recente" estiver visível, the system shall
  centralizá-lo horizontalmente como uma pill de largura própria, sem esticar
  para a largura do container pai.

### Optional

- Where uma ferramenta tem aprovação pendente (HITL), the system shall manter o
  comportamento existente de auto-abertura da linha para o botão de confirmação
  ficar visível, inalterado por esta spec.

### Unwanted behavior

- If o modelo usado não suportar raciocínio, then the system shall ignorar a opção
  de esforço silenciosamente (soft-fail) e responder normalmente, sem bloco de
  pensamento.
- If o turno terminar (texto final, erro ou abort) enquanto ainda há um raciocínio
  em aberto, then the system shall encerrar esse segmento ao final do stream, para
  não deixar o cabeçalho preso em "Pensando" indefinidamente.

## Critérios de Aceite

- [ ] `streamText()` usa `providerOptions.openrouter.reasoning.effort` em vez do
      parâmetro top-level `reasoning`.
- [ ] Funções puras de merge de segments testadas isoladamente, cobrindo: raciocínio
      solo (segmento único crescendo), raciocínio → ferramenta → raciocínio (3
      segments, não 2), múltiplas ferramentas consecutivas no mesmo grupo,
      atualização de ferramenta por id num grupo não-último, mensagem histórica
      (só ferramentas, sem raciocínio).
- [ ] Bloco de pensamento único substitui `ReasoningBlock` + `ToolBlock`,
      renderizando os segments na ordem cronológica real; `ToolRow` reaproveitado
      sem alterações.
- [ ] Botão "Ir ao mais recente" centralizado corretamente (`self-center`, sem
      `left-1/2 -translate-x-1/2` redundante).
- [ ] Ícone de enviar mensagem é uma seta para cima, não mais avião de papel.
- [ ] Chaves i18n órfãs após a mudança (`chat.working`, `chat.actionsCount`,
      `chat.family.*`) removidas de PT-BR e EN; nenhuma chave duplicada.
- [ ] Lint, typecheck e testes TS passam.

## Fora de Escopo

- Mudanças no protocolo SSE (tipos de evento, formato dos frames) ou nas
  ferramentas do agente.
- Persistir raciocínio em banco.
- Resumo de famílias de ferramentas (badges com ícone + contagem) e contador
  "N/total" no cabeçalho do bloco de pensamento — existiam no `ToolBlock` antigo e
  foram removidos junto da simplificação do cabeçalho para os dois estados
  textuais pedidos ("Pensando" / "Pensou por Xs"). O detalhe por ferramenta
  continua disponível expandindo o bloco.

## Riscos / Decisões pendentes

- O cabeçalho unificado ficou deliberadamente mais simples que o `ToolBlock`
  anterior (sem badges de família nem contador de progresso) — decisão tomada
  nesta entrega para caber nos dois estados textuais pedidos pelo owner. Reversível
  numa spec futura se fizer falta na prática.
- Caso o modelo retome raciocínio depois que o texto final já começou a chegar
  (não observado em uso normal, mas tecnicamente possível com
  `stopWhen: stepCountIs(12)`), o bloco de pensamento reabre acima do conteúdo já
  visível. Mesma limitação já existia no design anterior (campo `reasoning` também
  não previa esse caso); não otimizado nesta entrega.
