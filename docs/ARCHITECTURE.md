# Arquitetura — Voxen

Voxen é uma plataforma self-hosted de conhecimento com dois serviços de
aplicação e três serviços de infraestrutura. Docker Compose é a referência; a
imagem combinada `voxen` é o caminho recomendado no Easypanel.

## Visão do sistema

```text
Navegador
  |
  v
apps/web (Bun + Hono + React + AI SDK)
  |---- Postgres 17 (Prisma, FTS, grafo, usuários, jobs, configurações)
  |---- Redis 7 (wakeup, realtime, cache, rate limits)
  |---- volume local compartilhado (padrão) ou S3 compatível
  `---- apps/worker (Python asyncio + leases duráveis no Postgres)
```

O web é a única aplicação exposta. O worker não possui porta HTTP pública.
Redis acelera notificações, mas o Postgres continua sendo a fonte durável dos
jobs e do estado da aplicação.

## `apps/web`

O serviço Bun entrega a SPA React e a API Hono. Ele concentra:

- sessões Better Auth por email/senha e SSO OIDC opcional;
- onboarding, aprovação de usuários e controles administrativos;
- APIs de transcrições, notas, grafo, automações, MCP e custos;
- chat-agente integrado com AI SDK 7 e OpenRouter;
- recuperação determinística e isolada por usuário usando FTS, relações do
  grafo e transcrições no storage selecionado;
- streaming SSE de texto, raciocínio, ferramentas e progresso;
- configuração global da plataforma cifrada e integrações pessoais por usuário.

Configurações administrativas ficam em `/admin/*`. Perfil, contas de
plataforma e MCP pertencentes ao usuário ficam em `/conta/*`. Toda query de
dado pessoal deriva `userId` da sessão autenticada, nunca do request.

## `apps/worker`

O worker Python reivindica jobs duráveis com `FOR UPDATE SKIP LOCKED`. Cada
tentativa mantém um lease renovável; leases expirados são retomados ou falham
após o limite de tentativas. Redis serve apenas para wakeup e progresso.

Fluxo principal:

1. Validar o job e a URL de origem.
2. Preferir legendas oficiais quando disponíveis.
3. Extrair e segmentar mídia quando houver transcrição.
4. Enviar entradas suportadas aos modelos configurados pelo administrador.
5. Gerar Markdown canônico e metadados derivados.
6. Salvar artefatos pelo driver local ou S3 selecionado.
7. Espelhar texto, autoria, origem, tags e relações no Postgres.
8. Marcar o conteúdo pronto somente após todas as etapas obrigatórias atingirem
   estado terminal.

## Fluxos principais

### Primeira configuração

1. A primeira conta se torna administradora aprovada.
2. O administrador configura o OpenRouter no onboarding.
3. A Voxen valida a conta e aplica os slots canônicos de modelos.
4. Usuários seguintes herdam a configuração da plataforma, mantendo dados e
   sessões de contas pessoais isolados.

### Usuários e SSO

Contas locais começam pendentes até aprovação. O administrador também pode
configurar um provedor OIDC, limitar domínios de email e escolher aprovação
automática para identidades confiáveis.

### Chat

1. A mensagem do usuário autenticado é persistida.
2. FTS e grafo sugerem contexto compacto.
3. O agente confirma evidências com ferramentas progressivas.
4. Fatos atuais podem usar busca web e pesquisa no X usa seu slot dedicado.
5. URLs novas suportadas podem gerar ingestão e aguardar o resultado final.
6. Texto, raciocínio, fontes e ferramentas são transmitidos por SSE e
   persistidos cronologicamente.
7. O reload restaura a linha do tempo sem reenviar raciocínio salvo ao modelo.

## Dados e armazenamento

- Postgres: estado relacional, sessões, FTS, grafo, leases e custos.
- Redis: wakeups, eventos realtime, cache e rate limits.
- Storage: transcrições Markdown e artefatos de mídia em volume local
  compartilhado por padrão ou em S3 explicitamente selecionado. As chaves
  lógicas são iguais nos dois drivers e a troca não migra dados.

Pastas baseadas em tags são relações muitos-para-muitos virtuais. O grafo
complementa a busca textual e não substitui a recuperação de evidências.

## Anotações autorais e contexto externo derivado

- Uma nota pode preservar âncoras verificadas da transcrição com limites de
  linha/tempo, trecho selecionado e versão exata da fonte. Atualizações marcam
  divergências como stale sem reposicionar silenciosamente o trecho.
- Pesquisa posterior ao resumo é um enriquecimento durável separado. Ela nunca
  altera Markdown canônico ou `summaryMd`, trata fonte/web como dados não
  confiáveis e nasce `SUGGESTED` com citações URL estruturadas.
- A pesquisa separa um planejamento sem ferramentas das buscas limitadas. A
  aplicação valida os tópicos entre as fases, e a requisição com ferramenta
  nunca recebe transcrição, resumo, título ou justificativa do planejador.
- Apenas enriquecimentos atuais `READY + ACCEPTED` entram na recuperação padrão
  e no Brain, explicitamente tipados como derivados externos de menor
  autoridade. Dispensa, exclusão, expiração ou mudança de fonte remove somente
  os derivados.
- O administrador escolhe `OFF`, `MANUAL` ou `AUTO`; `OFF` é o padrão seguro.
  Web e MCP compartilham a mesma fila durável e isolada por usuário do modo
  automático. Mudanças de política e conteúdos-pai inativos cancelam trabalhos
  incompatíveis ainda não terminados em vez de permitir nova aquisição.
