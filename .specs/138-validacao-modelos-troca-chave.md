# Spec 138 — Validação de modelos na troca de chave

## Contexto

Trocar a chave da OpenRouter pode alterar o catálogo autorizado da instância.
Os seis modelos efetivos — inclusive overrides já escolhidos pelo administrador —
precisam continuar disponíveis e compatíveis antes que a nova chave seja usada.

## Glossário

- **modelo efetivo**: modelo configurado para uma finalidade, seja o padrão ou um override.
- **substituição**: modelo compatível do catálogo da nova chave escolhido para uma finalidade inválida.

## Requisitos

### Ubiquitous

- The system shall validar os seis modelos efetivos contra o catálogo autorizado da chave candidata.
- The system shall verificar disponibilidade e modalidade de entrada e saída exigida por cada finalidade.
- The system shall expor finalidade, identificador do modelo e motivo sem expor a chave candidata.

### Event-driven

- When um administrador envia uma nova chave, the system shall obter o catálogo dessa chave antes de persistir qualquer configuração.
- When um modelo efetivo falha a validação, the system shall retornar alternativas compatíveis para a mesma finalidade.
- When o administrador envia substituições compatíveis, the system shall salvar chave, modelos, preferências e revisão auditável em uma única alteração atômica.

### State-driven

- While existem incompatibilidades não resolvidas, the system shall manter a configuração persistida inalterada.

### Optional

- Where todos os modelos efetivos continuam válidos, the system shall preservar os overrides existentes sem exigir nova seleção.

### Unwanted behavior

- If uma substituição não pertence ao catálogo ou não atende à finalidade, then the system shall rejeitar a operação sem alteração parcial.
- If a nova chave é inválida ou o catálogo não pode ser obtido, then the system shall preservar chave, modelos e preferências anteriores.

## Critérios de Aceite

- [ ] Override ausente no catálogo bloqueia a troca sem persistência parcial.
- [ ] Override com modalidade incompatível bloqueia a troca e identifica a finalidade.
- [ ] Override compatível é preservado ao trocar a chave.
- [ ] Substituições compatíveis podem ser selecionadas e são gravadas atomicamente com a chave.
- [ ] A interface apresenta os modelos incompatíveis e suas alternativas autorizadas.
- [ ] Testes cobrem indisponibilidade, modalidade, sucesso com override e rejeição atômica.

## Fora de Escopo

- Alterar manualmente modelos sem trocar a chave, coberto pela spec 123.
- Painel contínuo de saúde da configuração de IA, coberto pela issue #534.

## Riscos / Decisões pendentes

- O catálogo autorizado é consultado no instante da troca; uma indisponibilidade posterior será acompanhada pelo painel de saúde.
