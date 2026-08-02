# Spec 133 — Configuração global auditável

## Contexto

A configuração da instância é global e altera a execução de todos os workspaces.
Administradores precisam rastrear cada alteração sem revelar segredos e reconhecer
qual configuração uma execução utilizou.

## Glossário

- **revisão**: registro imutável e ordenado de uma alteração atômica da configuração global.
- **segredo**: valor de chave, token, cookie ou credencial que não pode aparecer no histórico.

## Requisitos

### Ubiquitous

- The system shall criar uma revisão ordenada para cada alteração efetiva da configuração global.
- The system shall registrar executor administrativo, data, motivo opcional e chaves alteradas em cada revisão.
- The system shall redigir o valor anterior e posterior de todo segredo em revisões e respostas administrativas.
- The system shall associar a revisão corrente a cada job e turno de chat criados após sua publicação.

### Event-driven

- When um administrador salva uma configuração, the system shall persistir settings e revisão na mesma transação.
- When um administrador solicita o histórico, the system shall retornar apenas metadados e diffs permitidos.
- When um administrador solicita rollback de uma revisão, the system shall restaurar somente valores não secretos em uma nova revisão.

### State-driven

- While uma alteração global está em andamento, the system shall serializar alterações concorrentes para manter a sequência e o diff consistentes.

### Optional

- Where um motivo é informado, the system shall armazená-lo com no máximo 500 caracteres.

### Unwanted behavior

- If um usuário não administrador lê, cria ou reverte revisões, then the system shall negar a operação sem expor configuração.
- If uma revisão contém somente alterações secretas, then the system shall permitir sua auditoria sem armazenar o valor secreto.
- If o rollback inclui uma alteração secreta, then the system shall ignorá-la e informar que requer reconfiguração explícita.

## Critérios de Aceite

- [ ] Alteração atômica cria uma única revisão com executor, motivo e diff.
- [ ] Histórico e API nunca retornam valores secretos.
- [ ] Rollback cria nova revisão e não restaura segredos.
- [ ] Jobs e turnos de chat novos guardam a revisão vigente.
- [ ] Autorização, redação, atomicidade, histórico e rollback possuem testes.

## Fora de Escopo

- Configuração de modelos ou chaves por usuário.
- Exibição do painel de saúde de IA, coberto pela issue #534.

## Riscos / Decisões pendentes

- Enriquecimentos futuros usarão a mesma referência de revisão de jobs; o contrato será aplicado ao criar esses fluxos.
