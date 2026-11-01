# Arquitetura — Voxen

Voxen é uma plataforma self-hosted de conhecimento com um serviço de
aplicação e dois serviços de infraestrutura. Docker Compose é a referência; a
imagem combinada `voxen` é o caminho recomendado no Easypanel.

## Visão do sistema

```text
Navegador
  |
  v
apps/web (Bun + Hono + React)
  |---- Postgres 17 (Prisma, FTS, grafo, usuários, jobs, configurações)
  |---- Redis 7 (wakeup, realtime, cache, rate limits)
  `---- volume local compartilhado (padrão) ou S3 compatível
```

O web é a única aplicação. A manutenção retida (exclusões de conhecimento)
roda no próprio processo web com leases duráveis no Postgres. Redis acelera
notificações, mas o Postgres continua sendo a fonte durável dos jobs e do
estado da aplicação.

## `apps/web`

O serviço Bun entrega a SPA React e a API Hono. Ele concentra:

- sessões Better Auth por email/senha e SSO OIDC opcional;
- onboarding, aprovação de usuários e controles administrativos;
- APIs de leitura da biblioteca, notas, grafo, MCP e conta;
- recuperação determinística e isolada por usuário usando FTS, relações do
  grafo e transcrições no storage selecionado;
- streaming SSE de texto, raciocínio, ferramentas e progresso;
- configuração global da plataforma cifrada e integrações pessoais por usuário.

Configurações administrativas ficam em `/admin/*`. Perfil, contas de
plataforma e MCP pertencentes ao usuário ficam em `/conta/*`. Toda query de
dado pessoal deriva `userId` da sessão autenticada, nunca do request.

## Manutenção retida (sem worker)

Não há worker separado. As exclusões de conhecimento (`DELETE_KNOWLEDGE`)
são executadas pelo próprio processo web (`knowledge-deletion-executor`),
com claim `FOR UPDATE SKIP LOCKED`, lease com heartbeat e orçamento de 3
tentativas. Leases expirados são retomados pelo drain de startup e pelo
intervalo periódico. Conteúdo preparado chega por contratos versionados
HTTP/MCP; a Voxen nunca executa modelos, transcrição ou scraping.

Tabelas aposentadas do Produto 2 (chat, aprovações, custos, automações,
pesquisa, memória) foram removidas por migrations forward com o histórico
preservado. Antes de dropar tabelas conversacionais, exporte o arquivo:
`DATABASE_URL=... ./scripts/export-chat-archive.sh ./backups`.

## Fluxos principais

### Primeira configuração

1. A primeira conta se torna administradora aprovada.
2. O administrador conclui o onboarding com idioma e fuso horário — sem
   conta de provedor, chave ou modelo.
3. Usuários seguintes herdam a configuração da plataforma, mantendo dados e
   sessões de contas pessoais isolados.

### Usuários e SSO

Contas locais começam pendentes até aprovação. O administrador também pode
configurar um provedor OIDC, limitar domínios de email e escolher aprovação
automática para identidades confiáveis.

### Recuperação (sem chat integrado)

1. O cliente MCP ou a biblioteca consultam a base com FTS determinístico.
   Títulos têm peso A e corpo/tags peso B (mesmo esquema em notas e transcrições;
   tags de transcrição entram via subconsulta indexada e atualizam na vinculação),
   com ordenação por score e identidade; trechos destacados não usam pesos.
2. Leituras progressivas retornam estrutura (outline) e depois trechos
   estreitos (linhas/seção/intervalo), com cursores assinados e orçamentos
   de resposta.
3. Relações do grafo complementam a busca textual com evidência ancorada.
4. Citações são verificadas contra o conteúdo canônico armazenado; sem
   evidência, o sistema reporta ausência em vez de sintetizar resposta.

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
  incompatíveis ainda não terminados em vez de permitir nova aquisição. Fila e
  claim leem a política sob o mesmo lock transacional das configurações; a
  inativação do pai cancela o trabalho na própria transação de lifecycle. Todo
  enqueue também bloqueia a linha da transcrição até criar o trabalho, fechando
  a corrida entre criação, arquivamento e restauração imediata.
