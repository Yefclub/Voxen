# Spec 132 — HITL: retomar o agente após confirmar + “sempre permitir”

## Contexto

A spec 090 introduziu a pausa estrutural do HITL (criar nota) e a UI fixa acima do
composer, mas deixou de fora a **retomada automática do agente** após a
confirmação. Na prática o usuário aprova, a nota é criada e a conversa “morre”.

O padrão de mercado (AI SDK tool-approval-response, OpenAI Agents `alwaysApprove`)
é pause → decide → **resume** o run com o resultado da ferramenta. Esta spec
fecha esse gap e adiciona preferência de “sempre permitir” por classe de ação.

Supersede parcial de 090: a linha “fora de escopo — retomada automática” deixa de
valer.

## Glossário

- **Resume turn**: segundo turno de agente, iniciado após approve bem-sucedido,
  com o resultado da ação já no histórico.
- **Always-allow**: preferência do usuário para pular o HITL de uma ação
  (ex.: `create_note`) em turnos futuros.

## Requisitos

### Ubiquitous

- The system shall executar o efeito colateral da aprovação no máximo uma vez
  (idempotente / fail-closed no segundo approve do mesmo id).
- The system shall persistir preferências always-allow por usuário e por ação
  (não global da instância).

### Event-driven

- When o usuário confirmar uma aprovação pendente, the system shall (1) executar
  a ação, (2) registrar a confirmação na trilha e (3) iniciar um turno de resume
  do agente com o desfecho disponível no contexto.
- When o usuário escolher “sempre permitir” para a ação, the system shall gravar
  a preferência e, no mesmo fluxo, confirmar a aprovação pendente e retomar o
  agente.
- When o agente propuser `create_note` e o usuário já tiver always-allow para
  essa ação, the system shall não pausar o turno e shall executar a criação
  sem card HITL.

### Unwanted

- If o approve for reenviado após sucesso, then the system shall recusar sem
  criar segunda nota e sem segundo resume.
- If always-allow não incluir a ação, then the system shall manter o HITL
  obrigatório para essa ação.

## Critérios de Aceite

- [ ] Approve cria a nota uma vez e dispara resume (stream de assistente)
- [ ] UI com Confirmar + Sempre permitir
- [ ] Preferência always-allow impede novo card HITL para create_note
- [ ] Spec 090 atualizada (resume não é mais fora de escopo)
- [ ] Testes unitários/integração nos caminhos shipped

## Fora de Escopo

- UI de recusar / editar parâmetros
- Always-allow para tools além de create_note
- Web Push / PWA

## Riscos

- Double-write: execute da tool e approveChatAction não podem ambos criar a nota
  no mesmo fluxo — UI path cria no approve; always-allow cria no execute.
