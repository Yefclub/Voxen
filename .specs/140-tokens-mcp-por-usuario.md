# Spec 140 — Tokens MCP por usuário

## Contexto

O token MCP único da instância associa toda chamada a apenas um workspace. Isso
impede o uso seguro do MCP por equipes: um token vazado pode operar a Base de
conhecimento do dono global e não há revogação individual ou escopo explícito.

## Glossário

- **Token MCP**: credencial Bearer emitida uma única vez para conectar um cliente MCP.
- **Escopo**: permissão `READ` ou `WRITE` concedida ao token.

## Requisitos

### Ubiquitous

- The system shall vincular cada token MCP a exatamente um usuário aprovado e filtrar todas as ferramentas pelo `userId` desse dono.
- The system shall armazenar somente o hash de um token MCP e nunca devolver o segredo depois da criação.
- The system shall registrar criação, último uso, expiração opcional, escopos e revogação de cada token.
- The system shall manter a validação de Origin para proteção contra DNS rebinding.

### Event-driven

- When um usuário aprovado cria um token enquanto a política permitir, the system shall devolver o segredo uma única vez e persistir seus metadados.
- When um token com escopo `WRITE` autentica no MCP, the system shall expor as ferramentas de escrita além das ferramentas de leitura.
- When um token é revogado ou expira, the system shall rejeitar autenticação MCP subsequente.
- When um administrador revoga um token, the system shall preservar o registro sem o segredo e bloquear seu uso imediatamente.
- When a instância possui a credencial global legada, the system shall permitir que um administrador a revogue explicitamente.

### State-driven

- While a política de tokens de usuário estiver desabilitada, the system shall negar a criação por usuários não administradores.

### Optional

- Where uma data de expiração for informada, the system shall aceitá-la somente quando estiver no futuro.

### Unwanted behavior

- If um chamador tentar acessar ou modificar dados de outro usuário por id, parâmetro ou conteúdo de prompt, then the system shall tratar o item como inexistente no workspace do token.
- If escopos, rótulo ou expiração forem inválidos, then the system shall rejeitar a criação sem emitir token.

## Critérios de Aceite

- [ ] Usuário aprovado cria e revoga os próprios tokens quando a política permite.
- [ ] Admin lista metadados sem segredos, altera a política e revoga qualquer token.
- [ ] Token `READ` não anuncia ferramentas de escrita e token `WRITE` permanece restrito ao dono.
- [ ] Revogação, expiração e token legado são testados.
- [ ] Tentativas MCP entre workspaces permanecem isoladas.

## Fora de Escopo

- OAuth, delegação entre usuários e compartilhamento de Base de conhecimento.

## Riscos / Decisões pendentes

- A credencial global legada deixa de autenticar imediatamente após a migração; o admin pode removê-la de forma auditável.
