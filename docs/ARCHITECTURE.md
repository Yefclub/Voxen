# Arquitetura — Voxen

Voxen é uma plataforma self-hosted de conhecimento com um serviço de
aplicação, um serviço opcional de captura e dois serviços de infraestrutura.
Docker Compose é a referência; a imagem combinada `voxen` é o caminho
recomendado no Easypanel, com o `capture-worker` como segundo serviço quando
a captura de links for usada.

## Visão do sistema

```text
Navegador
  |
  v
apps/web (Bun + Hono + React)
  |---- Postgres 17 (Prisma, FTS, grafo, usuários, jobs, configurações)
  |---- Redis 7 (wakeup, realtime, cache, rate limits)
  |---- volume local compartilhado (padrão) ou S3 compatível
  |---- OpenAI / Anthropic / OpenRouter / xAI / Gemini (endpoints fixos, chave por usuário)
  `---- capture-worker (rede interna, token bearer)
          `---- proxy de saída Smokescreen ---> só internet pública
```

O web concentra todo acesso a banco, storage e provedores. Jobs de captura,
exclusões de conhecimento e manutenção rodam no próprio processo web com
leases duráveis no Postgres. O capture worker só baixa e converte mídia; não
tem `MASTER_KEY`, chave de provedor nem credencial de banco. Redis acelera
notificações, mas o Postgres continua sendo a fonte durável dos jobs e do
estado da aplicação.

## `apps/web`

O serviço Bun entrega a SPA React e a API Hono. Ele concentra:

- sessões Better Auth por email/senha e SSO OIDC opcional;
- onboarding, aprovação de usuários e controles administrativos;
- APIs de leitura da biblioteca, notas, grafo, MCP e conta;
- recuperação determinística e isolada por usuário usando FTS, relações do
  grafo e transcrições no storage selecionado;
- persisted SSE output, tool activity and progress without private reasoning;
- configuração global da plataforma cifrada e integrações pessoais por usuário.

Configurações administrativas ficam em `/admin/*`. Perfil, contas de
plataforma e MCP pertencentes ao usuário ficam em `/conta/*`. Toda query de
dado pessoal deriva `userId` da sessão autenticada, nunca do request.

## Jobs em segundo plano

Exclusões de conhecimento (`DELETE_KNOWLEDGE`) e capturas (`CAPTURE_LINK`,
`CAPTURE_UPLOAD`) rodam no processo web com claim `FOR UPDATE SKIP LOCKED`,
lease com heartbeat e orçamento de 3 tentativas com backoff para erros
transitórios. Leases expirados são retomados pelo drain de startup e pelo
intervalo periódico; um restart retoma o trabalho em vez de perdê-lo.

## `capture-worker` (spec 220)

Container separado com yt-dlp, Deno, ffmpeg/ffprobe (build BtbN
`linux64-lgpl` sem modificação, só como binário separado) e Trafilatura. Não
publica portas, só aceita requisições com `CAPTURE_WORKER_TOKEN`, roda como
usuário não-root com root filesystem somente leitura, todas as capabilities
removidas e `no-new-privileges`, e envia toda saída de rede pelo Smokescreen,
que bloqueia faixas privadas, loopback, link-local e de metadados depois do
DNS e dos redirects.

O web acessa o worker por `CAPTURE_WORKER_URL`. Sem o worker, a base continua
funcionando e as capturas terminam com `WORKER_UNAVAILABLE` depois das
tentativas.

## Fluxo de captura

1. O usuário envia um link (`POST /api/captures`), um arquivo
   (`POST /api/captures/upload`) ou um compartilhamento do PWA
   (`POST /share-target`). As verificações rodam de forma síncrona e em ordem:
   formato da URL e endereços privados literais, captura ativa do mesmo link,
   mesmo link já na biblioteca (oferece reprocessar) e papel de texto
   configurado. Só então o job é criado.
2. O runner pede ao worker o texto (legendas, post, página ou documento),
   metadados e até 50 comentários. Vídeos e áudios são processados por
   inteiro (spec 221): sem legenda, a fala é sempre transcrita pela cadeia de
   STT, e a descrição ou o texto do post continua no documento como contexto;
   com legenda, o STT não roda. Quando há vídeo e papel de visão, o worker
   devolve até quatro quadros (`/v1/frames`), descritos numa única chamada
   junto com até duas thumbnails ou imagens do post (no máximo seis imagens).
   Sem vídeo, as imagens só são descritas quando o texto é curto. O formato
   do áudio (MP3 ou WAV para o STT local) é escolhido antes de baixar. Se o STT
   falha em toda a cadeia e há pelo menos 200 caracteres de outro texto, ou se
   a extração de quadros ou a visão falham, o documento sai com
   `COMPLETED_WITH_WARNINGS` e o aviso aparece no card da captura. O resultado
   do worker fica guardado como artefato de captura, então uma nova tentativa
   não baixa de novo.
3. Uma única chamada estruturada, sem ferramentas e sem busca na web, gera
   título, resumo, pontos-chave, tags e entidades; o conteúdo capturado
   (incluindo até 20.000 caracteres de comentários) entra como dado não
   confiável. Com comentários, o schema pede também um ponto sobre a recepção
   do público.
4. O documento é publicado pelo contrato interno de publicação versão 2
   (`DOCUMENT`) no mesmo storage, índice e grafo do conteúdo preparado.
   Reprocessar atualiza o mesmo documento e guarda o texto anterior como versão
   da fonte.
5. Eventos de progresso (`extracting`, `transcribing`, `describing_images`,
   `interpreting`, `publishing`) são persistidos e transmitidos por SSE com
   replay por `Last-Event-ID`. Cancelar, tentar de novo (mesma linha, tentativa
   zerada) e reprocessar ficam em `/capturar` e na página do documento.

Chaves de provedor são por usuário, cifradas com `MASTER_KEY`, e usadas só
contra os endpoints fixos de OpenAI, Anthropic, OpenRouter, xAI e Gemini. Cada
papel (rápido, padrão, visão, STT) tem uma cadeia ordenada de até 4 modelos: se
um falha, o próximo é tentado (spec 221). Toda falha
tem código estável (`AI_NOT_CONFIGURED`, `LOGIN_REQUIRED`, `NO_TEXT`, …),
mensagem localizada e ação sugerida.

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

### Deterministic retrieval

1. O cliente MCP ou a biblioteca consultam a base com FTS determinístico.
   Títulos têm peso A e corpo/tags/pasta peso B em transcrições (nomes de tags
   e da pasta entram via subconsultas, atualizados na vinculação, movimentação
   e renomeação); notas seguem título A e corpo B, com ordenação por score e
   identidade; trechos destacados não usam pesos. Cabeçalhos do `.md` entram no
   índice como texto corrido (peso B), sem coluna nova: um boost tipo título
   para headings segue adiado sem benefício medido.
2. Leituras progressivas retornam estrutura (outline) e depois trechos
   estreitos (linhas/seção/intervalo), com cursores assinados e orçamentos
   de resposta.
3. Relações do grafo complementam a busca textual com evidência ancorada.
4. Citações são verificadas contra o conteúdo canônico armazenado; sem
   evidência, o sistema reporta ausência em vez de sintetizar resposta.

## Continuous assistant (spec 228)

`/chat` adds one persistent conversation per approved user through Vercel AI
SDK. PostgreSQL owns ordered messages, revision fences, execution leases,
replayable events, exact confirmation proposals, action receipts and derived
working memory. Browser disconnection does not stop execution; explicit stop
or rewind invalidates its lease. Restart recovery retains partial output and
receipts rather than replaying completed effects.

Knowledge tools reuse deterministic retrieval and progressive reads. Clear
user requests can create bounded captures or notes through existing services;
ambiguous additions require an exact contextual confirmation. Only the current
user request or its persisted confirmation grants permission. Source text and
memory never do. Web discovery is opt-in with an encrypted personal Brave key;
page reads use the existing isolated capture worker. No shell sandbox is added.

The former Product 2 archive remains historical data. New `Assistant*` tables
have their own forward migrations; they do not restore retired executors or
import archived conversations. See [the assistant guide](ASSISTANT.md) and
ADR-017. Specs 229–230 describe the following enrichment/indexing increments.

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
