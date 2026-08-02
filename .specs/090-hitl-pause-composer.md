# Spec 090 — HITL com pausa, acima do composer e sem TTL

## Contexto

A confirmação humana (HITL) do chat — hoje usada em propostas de criação de
nota — aparece embutida no bloco “Pensando”, como se fosse mais um passo do
raciocínio. O agente também continua gerando texto depois de “pedir”
confirmação, porque a ferramenta devolve um resultado sintético
(`approvalRequired`) em vez de interromper o turno. Além disso, a aprovação
expira em 15 minutos: se o usuário sair e voltar depois, o botão some ou falha.

O padrão de mercado (AI SDK tool approval, LangGraph interrupt, Cursor) é:
interromper o turno até a decisão humana, expor a confirmação de forma
persistente e fixa perto do composer, e só então executar o efeito colateral.

## Glossário

- **HITL**: confirmação humana obrigatória antes de uma ação com efeito na base.
- **Pausa estrutural**: o turno do agente termina quando a aprovação é
  necessária; nenhum raciocínio ou texto adicional é gerado até a decisão.
- **Composer**: caixa de envio de mensagens do chat (promptbox).
- **Aprovação pendente**: registro ainda não decidido (aprovado/recusado).

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall exigir confirmação humana antes de executar ações de escrita
  propostas pelo agente (criação de nota).
- The system shall manter aprovações pendentes sem prazo de expiração até o
  usuário decidir ou a conversa ser limpa.
- The system shall exibir a UI de confirmação HITL imediatamente acima do
  composer, fora do bloco de raciocínio.
- The system shall manter no desktop as dimensões atuais do chrome; no mobile,
  the system shall manter os botões do cabeçalho direito com o mesmo tamanho
  alvo (32×32 px) e o mesmo tamanho de ícone (16×16 px) do botão que abre a
  sidebar.

### Event-driven (resposta a evento)

- When o agente solicitar uma ação que exige HITL, the system shall encerrar o
  turno sem executar a ação e sem continuar o raciocínio/resposta após o pedido.
- When o usuário confirmar uma aprovação pendente, the system shall executar a
  ação uma única vez, marcar a aprovação como concluída e remover a UI HITL.
- When o usuário reabrir a conversa com aprovações ainda pendentes, the system
  shall voltar a exibir a UI HITL acima do composer.

### State-driven (durante um estado)

- While houver aprovação pendente na conversa, the system shall manter a UI HITL
  visível acima do composer mesmo que o bloco “Pensando” esteja recolhido.
- While uma ferramenta estiver apenas aguardando confirmação (sem execução em
  andamento), the system shall não manter o bloco de raciocínio no estado
  “Pensando”.

### Unwanted behavior (condições de erro)

- If a confirmação não existir, já tiver sido usada ou não pertencer ao usuário,
  then the system shall recusar a aprovação sem efeito colateral.
- If o bloco de raciocínio listar a ferramenta pendente, then the system shall
  não renderizar o botão de confirmar dentro desse bloco.

## Critérios de Aceite

- [x] Pedido HITL encerra o turno; não há raciocínio/texto do agente depois do
      pedido na mesma resposta.
- [x] Card de confirmação aparece acima do composer, não dentro de “Pensando”.
- [x] Recarregar a página com aprovação pendente restaura o card HITL.
- [x] Aprovação não expira por tempo; só some após decisão ou limpeza da
      conversa.
- [x] Confirmar cria a nota uma vez e limpa o estado pendente na mensagem.
- [x] No mobile, botões do cabeçalho direito têm 32×32 px e ícone 16×16 px,
      alinhados ao botão da sidebar.
- [x] Testes cobrindo approve sem TTL, persistência do estado pendente e
      `segmentsRunning` sem tratar approval-required como “rodando”.
- [ ] Lint, typecheck e testes TS verdes (sem Docker/Playwright nesta entrega).

## Fora de Escopo

- ~~Retomada automática do agente (segundo turno LLM) após a aprovação.~~
  **Superseded por spec 132** — resume + always-allow.
- UI de rejeitar/editar parâmetros da proposta (apenas confirmar; 132 adiciona
  “sempre permitir”, não recusar).
- Migração do chat para `useChat` / UIMessageStream.
- Playwright e subida de Docker nesta entrega.

> 2026-08-02: spec 132 implementa resume pós-approve e always-allow por ação.

## Riscos / Decisões pendentes

- A execução da nota permanece no endpoint de approve (efeito direto), não no
  `execute` da ferramenta via segundo call do AI SDK — suficiente para o produto
  atual e evita double-create.
- `expiresAt` passa a ser opcional no banco; registros antigos com data no
  passado continuam aprováveis se ainda estiverem `PENDING`.

> 2026-07-14: `approveChatAction` passa a localizar a mensagem pelo
> `approvalId` no JSON (SQL `LIKE` em `tools`/`segments`), sem janela
> `take: 40`, para não deixar card HITL fantasma em conversas longas.
>
> 2026-07-14: reconcilição de HITL legado — ao carregar o snapshot ou
> confirmar, aprovações ausentes/EXPIRED com payload na mensagem são
> revividas; cards de APPROVED/REJECTED são limpos da mensagem.
