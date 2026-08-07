# Spec 137 — Matriz de regressão de isolamento entre usuários

> **2026-08-07 amendment:** Every physical object shall remain under the
> authenticated workspace key for both local and S3 drivers. Driver-neutral
> storage failure shall preserve the same fail-closed isolation behavior.

## Contexto

Cada usuário aprovado opera uma Base de conhecimento própria. O mesmo limite
precisa valer para HTTP, ferramentas de recuperação, jobs do worker,
armazenamento de objetos, cache/eventos e MCP. Convenções de código não
detectam uma regressão quando uma nova consulta ou ferramenta perde o escopo.

Esta spec transforma essa fronteira em testes de segurança executáveis no CI.

## Glossário

- **Dono**: usuário que criou o recurso.
- **Solicitante**: usuário autenticado que tenta acessar um recurso de outro
  dono.
- **Erro seguro**: resposta que não revela existência, título, conteúdo,
  metadados ou identificadores de um recurso alheio.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall escopar toda leitura e escrita de conteúdo pessoal ao usuário
  autenticado ou ao `userId` recebido internamente do job já validado.
- The system shall manter namespaces distintos para objetos S3, chaves/canais de
  cache do Brain e canais de eventos de jobs de usuários distintos.
- The system shall rejeitar a persistência de evento de job quando o `jobId` não
  pertencer ao `userId` informado pelo worker ou pelo publicador web.
- The system shall executar a matriz de regressão de isolamento nas suítes web e
  worker executadas pelo CI.

### Event-driven (resposta a evento)

- When um solicitante requisitar, alterar, remover, mover, cancelar ou assinar
  eventos de um recurso pertencente a outro usuário, the system shall responder
  com erro seguro e preservar o recurso do dono.
- When uma consulta auxiliar de recuperação pesquisar notas ou transcrições, the
  system shall retornar somente recursos do workspace solicitado.
- When um token MCP tentar usar ID ou referência de outro usuário, the system
  shall retornar erro de ferramenta sem conteúdo do recurso alheio nem escrita.
- When um administrador acessar endpoints administrativos, the system shall
  manter o escopo explícito desses endpoints e não conceder acesso implícito ao
  acervo de outro usuário.

### State-driven (durante um estado)

- While uma conexão de evento em tempo real estiver sendo aberta, the system
  shall validar a posse do job antes de assinar seu canal.
- While um job estiver sendo processado, the system shall gravar progresso,
  cache e objetos somente no namespace do dono do job.

### Optional (feature opcional)

- Where S3 ou Redis estiver indisponível, the system shall preservar o mesmo
  escopo de usuário nas decisões locais antes de qualquer tentativa externa.

### Unwanted behavior (condições de erro)

- If uma tentativa cross-user falhar, then the system shall not expor título,
  existência, trecho, metadado ou conteúdo do recurso alvo.
- If uma referência de pasta, tag, transcrição ou nota de outro usuário for
  enviada em uma escrita, then the system shall not criar nem alterar vínculo
  algum.

## Critérios de Aceite

- [ ] Fixtures criam dois usuários aprovados e um administrador.
- [ ] A matriz cobre leitura e escrita cruzada de transcrições, jobs, notas,
  pastas, tags, chat, Brain e custos.
- [ ] Endpoints de detalhe, mutação e SSE rejeitam IDs de outro usuário sem
  vazar o recurso.
- [ ] Recuperação auxiliar não retorna nota ou transcrição do outro workspace.
- [ ] Tokens MCP não podem ler ou alterar referências de outro usuário.
- [ ] Chaves de S3, cache/invalidação do Brain e eventos de job permanecem
  separadas por usuário.
- [ ] O publicador web e o worker não persistem progresso para job de outro
  usuário.
- [ ] A suíte automatizada falha caso algum desses limites seja removido.

## Fora de Escopo

- Redesenho do modelo de tokens MCP, que pertence à issue #535.
- Controle de autorização por organização, planos ou multi-tenancy comercial.
- Teste de conectividade contra serviços S3/Redis externos; a matriz valida os
  limites e contratos antes de operações de rede.

## Riscos / Decisões pendentes

- A implementação atual de token MCP é global e será substituída na issue #535.
  A matriz preserva o teste de tentativa cross-user no contrato atual e deverá
  migrar suas fixtures para os tokens individuais nessa mudança.

> 2026-08-02: requisitos aprovados no objetivo global de implementação das issues #532–#544.
