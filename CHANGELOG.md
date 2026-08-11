# Changelog

## v0.14.5-dev.1786427252 — 2026-08-11 · Dev

### 🔒 Smaller worker runtime attack surface

The production worker image no longer includes the unused global Python package
installer and its vendored dependencies. Runtime dependencies remain locked in
the uv-managed virtual environment, while image vulnerability scans now inspect
only packages that the worker can execute.

## v0.14.5-dev.1786366281 — 2026-08-10 · Dev

### ✨ Safe background deletion across the knowledge base

Knowledge deletion now runs through Voxen's durable job queue instead of holding
the browser, internal assistant, or MCP request open while storage and graph data
are removed. Transcripts, notes and note trees, saved media, library folders, and
reviewable transcript context share the same observable and retryable workflow.

The internal assistant always presents a destructive confirmation before
enqueueing a deletion. MCP clients receive a write-scoped deletion tool that
requires the user-owned target identifier, its exact current title, and an
explicit confirmation flag. Cross-workspace targets remain indistinguishable
from missing content. Transcript hard deletion requires the content to remain in
trash and is serialized against source refresh; folder cascades reject corrupted
cross-workspace trees.

The queue and job detail views now show deletion-specific progress and terminal
feedback. Graph cleanup is source-scoped, preserves unrelated manual evidence,
and invalidates the user's graph snapshot only after the background mutation.

## v0.14.5-dev.1786354871 — 2026-08-10 · Dev

### 🎨 Explore Mermaid diagrams with an interactive canvas

Mermaid diagrams in chat responses, notes, and transcript content now open in an interactive
canvas. You can zoom from 50% to 300%, drag to inspect large flows, reset the view, and expand the
diagram into a focused near-full-screen workspace. Mouse, touch, wheel, and keyboard controls are
supported without weakening Voxen's strict SVG sanitization.

## v0.14.5-dev.1786352459 — 2026-08-10 · Dev

### ✨ Correct transcripts without changing original evidence

Transcript details now include a reviewable correction layer for exact replacements and
insertions. Every accepted change creates an immutable revision, keeps the captured source
untouched, detects concurrent edits, and can be inspected, restored, or reset from the web
interface. Search, summaries, chat retrieval, and grounded graph compilation consume the active
correction while preserving source provenance.

The integrated assistant can propose a bounded correction preview that always requires explicit
approval. MCP clients with write scope receive the same revision-aware correction and restore
operations; read-only tokens can search and inspect correction history without gaining mutation
access.

## v0.14.5-dev.1786341311 — 2026-08-10 · Dev

### ✨ Safe, versioned note editing

Notes now keep immutable revision history across the web interface, chat, and MCP. Voxen can locate and change an exact passage without replacing the entire document, detects concurrent edits before they overwrite newer work, preserves the local draft during a conflict, and lets users inspect or restore an earlier revision. Graph links and transcript evidence remain connected while only the edited note is refreshed.

Chat confirmations show a server-validated, bounded before/after preview, and paginated history keeps every revision accessible even after long editing sessions.

## v0.14.5-dev.1786329638 — 2026-08-09 · Dev

### ✨ Explore the complete knowledge graph from the server

Graph search now covers every active node owned by the current user instead of only the
rendered snapshot. Selecting a result loads a bounded one- or two-hop neighborhood, while
the default view reports complete candidate totals and prioritizes representative content.

## v0.14.5-dev.1786324652 — 2026-08-09 · Dev

### 🐛 Semantic graph indexing now recovers automatically

Semantic graph extraction now resumes after temporary worker, provider, or graph-lock
interruptions instead of leaving transcript concepts and relationships pending indefinitely.
Graph status also distinguishes source-node coverage from semantic segment progress, making
pending, retrying, completed, skipped, and terminal work observable.

## v0.14.5-dev.1786233786 — 2026-08-08 · Dev

### 🐛 Recover interrupted saved-media migrations during startup

Voxen now detects the known interrupted saved-media migration, repairs and validates its
database objects idempotently, and resumes pending Prisma migrations. Unrecognized migration
failures continue to stop startup for explicit operator review.

## v0.14.5-dev.1786224946 — 2026-08-08 · Dev

### ✨ Research gaps with the original source and a visible trail

When selective research detects missing or inconsistent context, Voxen can now consult a
sanitized reference to the original source before performing up to two complementary public
searches. Planning, source consultation, research, synthesis, retries, failures, cancellation,
and completion remain visible in the originating queue item without reopening a completed job.
External evidence stays separate from the canonical summary as reviewable additional context.

## v0.14.5-dev.1786218603 — 2026-08-08 · Dev

### ✨ Reviewable Mermaid flows for transcripts

- Generate or regenerate a visual flow from a transcript without changing its canonical text or summary.
- Render validated Mermaid flowcharts in the transcript view and Markdown responses with a safe source fallback.
- Include the derived flow in full transcript reads from the integrated chat and MCP.

## v0.14.5-dev.1786211865 — 2026-08-08 · Dev

### 🐛 Correct MCP client setup contrast across themes

The selected MCP client configuration now uses a theme-safe nested surface and a horizontally scrollable client selector on narrow screens.

## v0.14.5-dev.1786209842 — 2026-08-08 · Dev

### ✨ Batch URL ingestion across the app, chat, and MCP

Voxen now accepts up to 20 links at once. Each link receives its own queue job and visible result,
so invalid, duplicate, existing, and newly queued sources can be handled independently.

## v0.14.5-dev.1786207296 — 2026-08-08 · Dev

### ✨ Save private media before adding it to the knowledge base

The new Downloads page stores supported YouTube, Instagram, TikTok, and X videos in the configured local volume or S3-compatible storage without exposing them to Graph, chat, AI retrieval, or MCP. Each user gets an isolated library, authenticated range downloads, durable queue progress, bounded files, safe retries, and an explicit action to process a saved file through Voxen later without downloading the source again. Permanently deleting the linked transcript keeps the saved media available for future processing.

## v0.14.5-dev.1786200221 — 2026-08-08 · Dev

### ✨ Chat references open inside Voxen

Verified citations now open their source content in the existing side panel, preserving the conversation and offering an explicit action for the full transcript page.

## v0.14.5-dev.1786191801 — 2026-08-08 · Dev

### 🐛 MCP client configuration now follows the active theme

The client configuration panel on **Account → MCP Access** now uses the application surface palette. The panel remains readable in dark, light, and alternate interface themes instead of rendering a light text color as its background.

## v0.14.5-dev.1786187187 — 2026-08-08 · Dev

### ✨ MCP clients can connect through OAuth 2.1

Voxen now provides standards-based OAuth discovery, Authorization Code with
PKCE, rotating refresh tokens, revocation, consent, and read/write scopes for
remote MCP clients. Administrators can enable the capability and pre-register
public or confidential clients, while each user controls their own grants.
Existing personal MCP tokens continue to work unchanged.

## v0.14.5-dev.1786179760 — 2026-08-08 · Dev

### 🧹 Complete MCP client setup guidance

The MCP account page now provides copyable connection details for Codex,
Claude Code, OpenAI, Anthropic, Cursor, and MCP Inspector. Equivalent English
and Brazilian Portuguese guides document compatibility, token safety, public
HTTPS requirements, and actionable troubleshooting. Grok Web is clearly marked
as requiring the upcoming OAuth delivery instead of accepting personal tokens.

## v0.14.5-dev.1786178078 — 2026-08-08 · Dev

### 🐛 Resilient OpenRouter model fallbacks

OpenRouter rate limits are now treated as temporary failures with bounded retry
delays and a clear, actionable message. Administrators can configure one
compatible fallback for every AI model purpose, while initial setup suggests
safe alternatives automatically. Runtime usage and costs identify the model
that actually answered.

## v0.14.5-dev.1786127306 — 2026-08-07 · Dev

### 🐛 The dev container image now follows versioned code

After each automatic development version pull request passes CI and merges,
Voxen now publishes the combined image and waits for the registry push to
succeed. The mutable `dev` tag, its versioned tag, and the immutable SHA tag
therefore advance together, while `latest` remains reserved for stable
releases. Intermediate feature commits still do not publish deployable images.

## v0.14.5-dev.1786123967 — 2026-08-07 · Dev

### ✨ Summaries can trigger bounded optional research

Administrators can keep post-summary research off, allow manual requests, or
enable selective automatic checks. The canonical summary remains
transcript-only; the durable second stage may perform zero or bounded web
searches and always creates a cited suggestion for review. Failures, retries,
and cancellation never block a completed transcript. Tool-free planning is
isolated from bounded search requests, while policy and content lifecycle
changes cancel incompatible work across transaction-safe boundaries.

## v0.14.5-dev.1786116413 — 2026-08-07 · Dev

### ✨ External context is cited and reviewable

Transcript pages now have a separate additional-context lifecycle for external
research. Suggested results retain structured citations, model and cost
provenance, source freshness, and review status without changing the canonical
transcript or summary. Only fresh context explicitly accepted by the user can
enter search and Brain; dismissal or deletion removes only its derivatives.

## v0.14.5-dev.1786111854 — 2026-08-07 · Dev

### ✨ Notes can retain exact transcript passages

Text selected in a transcript can now become a note with verified line and
timestamp anchors. Anchored notes navigate back to and highlight the original
passage, remain available through the user-scoped API and MCP server, and keep
their evidence separate from authored note content. A source refresh marks an
outdated anchor stale instead of silently moving it.

## v0.14.5-dev.1786107441 — 2026-08-07 · Dev

### ✨ A newer published release is visible in navigation

Voxen now checks the official GitHub stable release from the server and shows
an update notice directly above What's new only when that release is newer than
the running build. The notice identifies the installed version and whether the
instance is running a development or production build. GitHub failures remain
silent and never interrupt navigation.

## v0.14.5-dev.1786104989 — 2026-08-07 · Dev

### 🛠️ New self-hosted installs use a local volume by default

New single-host installations no longer require MinIO. Web and worker share a
private persistent volume at `/data/storage` behind the same provider-neutral
contract, with atomic writes, authenticated reads, media ranges, path
containment, health checks, persistent-mount validation, consistent backups,
and non-root runtime access. Legacy Garage variables and mounted credentials
files remain supported by both runtimes.
Backup topology follows the active endpoint and container, so an obsolete MinIO
volume cannot be mistaken for a backup of external S3.
Existing non-empty S3 or Garage configuration remains on S3, while MinIO is an
explicit optional profile.

## v0.14.4 — 2026-08-07 · Produção

### Voxen 0.14.4 — clearer beta expectations

## Beta status made explicit

The public README now identifies Voxen as a beta under active validation. It
sets clear expectations that bugs, integration regressions, rough edges, and
breaking changes can still occur, and recommends backing up instance data and
reviewing release notes before upgrades.

## Validated workflows and community feedback

The project now documents the workflows already used by the maintainer for
supported YouTube and TikTok links, selected public web pages, and especially
posts from X. It also explains the practical goal of consolidating useful links
from social feeds, bookmarks, and personal notes into one searchable knowledge
library. Community members are invited to share experience and product ideas
through GitHub Discussions or reproducible issues without exposing private
data, credentials, or unredacted logs.

## Operational impact

This release changes public documentation and version metadata only. It does
not alter application runtime behavior, database schemas, deployment topology,
or configuration requirements.

## v0.14.3 — 2026-08-07 · Produção

### Voxen 0.14.3 — open-source launch readiness

## Focused workspace and evidence flow

The focused interface now behaves as a true workspace: its collapsed rail is
centered, the sources surface opens as part of the background workspace, and
the conversation contracts without the floating header covering content. Shell
spacing, mobile chat clearance, and the compact scrollbar controls were refined
as well. Artifacts are deliberately paused in navigation while their next
product iteration is prepared.

## Clearer personal and administrative boundaries

Personal profile, platform-account, and MCP pages now share the same page
hierarchy as the rest of the product. Instance configuration remains visibly
separate for administrators, with OIDC SSO support and stronger controls for
accounts, roles, and user isolation.

## Library retrieval informed by the knowledge graph

Transcript search is easier to reach and can use related concepts already
grounded in the graph in addition to traditional text fields. The additional
signal has controlled weight, skips short queries, and remains limited to the
current user's knowledge base.

## Trustworthy chat and release information

Chat reasoning renders Markdown using the same sanitization as responses. The
What's New feed is now bound to the environment that is actually running:
development and production histories cannot be mixed through a URL parameter.
New entries can carry curated English and Brazilian Portuguese text, while
legacy entries continue to fall back safely.

## Easier self-hosted deployment

The Easypanel guide now documents the supported single-image topology: one
combined Voxen App runs the web/API, worker, and integrated chat runtime, while
PostgreSQL, Redis, and S3-compatible storage remain persistent services. The
residential proxy agent is explicitly optional for VPS media extraction.

## v0.14.3-dev.1786078906 — 2026-08-07 · Dev

### 🐛 Legacy package retirement now has one deletion policy

The public release contract now consistently requires deleting the obsolete
web, worker, and chat packages together with all historical versions. The
release history and automated readiness checks enforce the same policy.

## v0.14.3-dev.1786076787 — 2026-08-07 · Dev

### 🐛 Protected version automation works with read-only defaults

GitHub Actions keeps read-only permissions by default while the repository
policy now permits the version workflow to create its protected pull request.

## v0.14.3-dev.1786076787 — 2026-08-07 · Dev

### 🐛 Repository topic policy converges reliably

The repository policy checker now compares GitHub topics as a set, preventing
false drift reports when the API returns the same topics in insertion order.

## v0.14.3-dev.1786075127 — 2026-08-07 · Dev

### 🔒 Open-source launch readiness

Voxen's public documentation now matches the integrated agent architecture,
the README presents the chat and knowledge-library experience, and production
dependencies were updated to patched releases. Repository policy is also
versioned for read-only workflow defaults and a clean squash-only history. The
public covers use anonymous demo data, and Dependabot monitors every supported
container image.

## v0.14.3-dev.1786071600 — 2026-08-06 · Dev

### 🧹 Retire legacy component images from public releases

Stable releases now publish the combined Voxen image as the only public
application image. The obsolete web, worker, and chat packages are deleted from
GHCR together with their historical versions and are no longer republished.

## v0.14.2 — 2026-08-05 · Produção

### Voxen 0.14.2 — focused knowledge workspaces and safer operations

## Focused workspace and evidence flow

The focused interface now behaves as a true workspace: its collapsed rail is
centered, the sources surface opens as part of the background workspace, and
the conversation contracts without the floating header covering content. Shell
spacing, mobile chat clearance, and the compact scrollbar controls were refined
as well. Artifacts are deliberately paused in navigation while their next
product iteration is prepared.

## Clearer personal and administrative boundaries

Personal profile, platform-account, and MCP pages now share the same page
hierarchy as the rest of the product. Instance configuration remains visibly
separate for administrators, with OIDC SSO support and stronger controls for
accounts, roles, and user isolation.

## Library retrieval informed by the knowledge graph

Transcript search is easier to reach and can use related concepts already
grounded in the graph in addition to traditional text fields. The additional
signal has controlled weight, skips short queries, and remains limited to the
current user's knowledge base.

## Trustworthy chat and release information

Chat reasoning renders Markdown using the same sanitization as responses. The
What's New feed is now bound to the environment that is actually running:
development and production histories cannot be mixed through a URL parameter.
New entries can carry curated English and Brazilian Portuguese text, while
legacy entries continue to fall back safely.

## Easier self-hosted deployment

The Easypanel guide now documents the supported single-image topology: one
combined Voxen App runs the web/API, worker, and integrated chat runtime, while
PostgreSQL, Redis, and S3-compatible storage remain persistent services. The
residential proxy agent is explicitly optional for VPS media extraction.

## v0.14.2-dev.1785911083 — 2026-08-05 · Dev

### 🐛 What's new now follows the active environment and language

The What's new feed now follows the environment actually running the instance:
development builds show only development entries, while stable deployments show
only production releases. The environment is informative rather than a manual
filter, so URLs cannot mix histories from another channel.

New release notes can include curated English and Brazilian Portuguese content.
The page and update details use the selected interface language, while older
single-language entries remain readable until they receive a translation.

## v0.14.1 — 2026-08-05 · Produção

### Voxen 0.14.1 — interface refinada e busca conectada

## Navegação focada mais integrada

A interface focada ganhou uma composição mais coesa: os controles da barra
recolhida ficam centralizados, o painel de fontes passa a fazer parte do fundo
do espaço de trabalho e a conversa se retrai suavemente quando as evidências são
abertas. O cabeçalho flutuante acompanha essa transição sem cobrir o conteúdo.

O espaçamento nas bordas, a altura do cabeçalho e as barras de rolagem também
foram refinados. No desktop, os controles direcionais respeitam os cantos
arredondados; no celular, a primeira mensagem permanece visível abaixo dos
controles. A área de Artefatos fica temporariamente fora da navegação enquanto
seu próximo ciclo de produto é preparado.

## Conta pessoal consistente e separada da administração

Perfil e segurança, contas de plataforma e acesso MCP agora compartilham a mesma
navegação, hierarquia visual e largura de conteúdo das demais páginas. Isso
reforça a separação entre escolhas particulares de cada pessoa e configurações
globais reservadas aos administradores da instância.

## Busca da biblioteca apoiada pelo grafo

A busca das transcrições ocupa uma posição mais fácil de encontrar e passa a
considerar conceitos relacionados já extraídos no grafo, além dos campos
textuais tradicionais. Os sinais adicionais têm peso controlado, ignoram
consultas curtas e continuam estritamente limitados à base do usuário atual.

## Raciocínio do chat com Markdown

O bloco de raciocínio agora apresenta títulos, listas, ênfases e código em
Markdown com a mesma sanitização aplicada às respostas. Textos estruturados
deixam de aparecer como marcação crua sem ampliar a superfície de conteúdo HTML.

## Publicação completa no Easypanel

Releases estáveis agora publicam também a imagem combinada que reúne web, chat e
worker. As tags da versão e `latest` permanecem alinhadas, e uma execução
interrompida pode ser retomada sem recriar a tag da release.

## v0.14.1-dev.1785898252 — 2026-08-04 · Dev

### 🧹 Busca da biblioteca apoiada pelo grafo

A busca da biblioteca ganhou uma posição mais clara e agora também encontra conteúdos por conceitos relacionados no grafo, sempre limitados à base do usuário.

## v0.14.1-dev.1785897416 — 2026-08-04 · Dev

### 🎨 Páginas pessoais de conta mais consistentes

As páginas de perfil, contas de plataforma e acesso MCP agora compartilham uma navegação própria, usam melhor o espaço disponível e permanecem claramente separadas da administração da instância.

## v0.14.1-dev.1785896005 — 2026-08-04 · Dev

### 🐛 Markdown no raciocínio do chat

O raciocínio exibido no chat agora interpreta listas, ênfases, títulos e código em Markdown, mantendo a apresentação compacta e as mesmas proteções usadas nas respostas.

## v0.14.1-dev.1785894389 — 2026-08-04 · Dev

### 🎨 Navegação e fontes mais integradas ao espaço de trabalho

The collapsed navigation rail now centers its controls across the complete
focus-mode gutter. Chat sources open as animated background content while the
conversation and floating controls retract together, and desktop scrollbar
arrows keep additional clearance from rounded application edges.

## v0.14.1-dev.1785875339 — 2026-08-04 · Dev

### 🐛 Mais respiro nas bordas da interface

As páginas voltam a iniciar com uma margem discreta no desktop, sem recuperar a
faixa vazia do cabeçalho. O painel flutuante se afasta da barra de rolagem e as
setas da rolagem passam a ficar centralizadas em áreas próprias, longe dos
cantos arredondados.

## v0.14.1-dev.1785872155 — 2026-08-04 · Dev

### 🐛 Mais espaço útil e navegação mais limpa

O cabeçalho flutuante ocupa menos espaço no desktop e deixa de criar uma faixa
vazia sobre o conteúdo. No celular, as mensagens do chat permanecem abaixo dos
controles, enquanto barras de rolagem mais finas exibem apenas a seta correta em
cada extremidade. A área de Artefatos fica temporariamente fora da navegação até
que seu desenvolvimento seja retomado.

## v0.14.1-dev.1785869169 — 2026-08-04 · Dev

### 🐛 Releases estáveis agora publicam a imagem completa do Easypanel

A publicação de uma release passa a gerar também a imagem combinada com web,
chat e worker, mantendo as tags da versão e `latest` alinhadas. Repetir o fluxo
para a mesma versão recupera uma publicação interrompida sem recriar a tag.

## v0.14.0 — 2026-08-04 · Produção

### Voxen 0.14.0 — espaços pessoais, login empresarial e qualidade verificável

## Uma interface que se adapta a cada pessoa

Cada usuário pode continuar com a navegação clássica ou ativar o novo modo
focado, inspirado no Vesper. Nesse modo, a navegação fica integrada ao fundo e
o conteúdo principal ganha uma superfície dedicada, sem alterar a experiência
em telas menores. A preferência é pessoal, acessível e permanece sincronizada
quando a pessoa retorna a outra aba do navegador.

## Administração e conta pessoal em lugares distintos

Configurações compartilhadas da instância agora vivem em uma área administrativa
própria, separada das páginas de uso diário e dos dados particulares. Modelos,
autenticação, integrações, usuários e custos ficam claros para administradores,
enquanto cada pessoa controla os próprios acessos MCP, expiração e revogação sem
expor segredos de outros usuários.

## Login empresarial com OIDC seguro

Administradores podem configurar provedores OpenID Connect para os domínios da
organização. O fluxo usa PKCE, exige e-mail verificado, valida destinos HTTPS e
mantém a política de aprovação de contas da Voxen. Segredos do provedor ficam
criptografados, tokens do provedor não são armazenados e contas bloqueadas ou
rejeitadas não conseguem criar sessão.

A configuração também preserva desafios DNS ainda válidos ao recarregar a
página, limita tentativas públicas de início de sessão e consulta somente
provedores verificados e ativos. Isso reduz abuso e evita invalidar um registro
TXT que já esteja em propagação.

## Qualidade e migrations verificadas antes do merge

O CI ganhou uma catraca de qualidade que acompanha cobertura, duplicação e
tamanho de arquivos sem exigir que toda a dívida histórica seja resolvida de
uma vez. Novas regressões são bloqueadas e recebem um relatório próprio para
orientar a correção.

O histórico do Prisma também passa por um gate dedicado: mudanças de schema
exigem migrations ordenadas, o histórico integrado não pode ser reescrito e a
evolução completa é reproduzida em PostgreSQL isolado antes do merge.

Os defaults de atualização das tabelas compartilhadas com o worker também foram
restaurados no próprio PostgreSQL. Assim, gravações diretas em segundo plano
continuam seguras mesmo quando não passam pelo cliente Prisma.

## Dependências críticas atualizadas e auditadas

As dependências web e do worker receberam correções para quatro vulnerabilidades
de alta severidade. O CI agora bloqueia novas ocorrências nas duas plataformas,
e a imagem do worker passa a instalar o lockfile auditado de forma estrita para
que o ambiente publicado corresponda ao que foi validado.

## Rolagem e grafo mais previsíveis

O modo focado ganhou barras de rolagem alinhadas às superfícies arredondadas,
com controles direcionais completos no desktop e comportamento preservado em
dispositivos de toque. No grafo, cobertura parcial deixa de aparecer como falha:
a interface explica que o conteúdo está aguardando indexação, respeita a janela
de nova tentativa sem consultas infinitas e atualiza o mapa assim que o processo
converge.

## Novidades de produção confiáveis

A preparação da release agora grava a nota curada no feed de **Novidades** de
forma idempotente. Assim, a página mostra o que realmente chegou à produção,
sem duplicar versões nem confundir entradas de desenvolvimento com releases
estáveis.

O versionamento de desenvolvimento passou a comparar `dev` com `main` e reserva
o próximo patch quando necessário. Builds de teste deixam de parecer anteriores
à versão estável em comparações SemVer, mantendo deploys e atualizações em ordem.

## v0.13.2-dev.1785864563 — 2026-08-04 · Dev

### 🐛 Development builds now stay ahead of the stable release

The automated development-version workflow now compares its package version
with `main`. When both point to the same release core, the next development
build advances to the following patch before adding its timestamp, preserving
correct SemVer ordering for deployments and update detection.

## v0.13.1-dev.1785862977 — 2026-08-04 · Dev

### 🐛 Hardened release reliability, SSO, and database writes

Database defaults used by background processing are restored so direct worker
writes remain safe after migration. OIDC setup now preserves an unexpired DNS
challenge across reloads, and public sign-in initiation has bounded abuse
controls.

The focused scrollbar controls have stronger contrast, session revalidation no
longer loses its first response, and deployment guidance now points to the
correct combined Easypanel image with safer secret handling.

## v0.13.1-dev.1785858147 — 2026-08-04 · Dev

### 🐛 Refined focused scrolling and recoverable graph indexing

Desktop scrollbars now include directional controls and stay visually inset
inside rounded focused panels. Partial Brain coverage is shown as a recoverable
waiting state and retried automatically instead of being logged and presented
as an indexing failure.

## v0.13.1-dev.1785851298 — 2026-08-04 · Dev

### 🔒 Patched vulnerable web and worker dependencies

Patched four HIGH-severity findings reported by the release security scan:

- `fast-uri` 3.1.5 resolves CVE-2026-18446;
- `ip-address` 10.3.1 resolves CVE-2026-69192;
- `aiohttp` 3.14.3 resolves CVE-2026-69244; and
- `cryptography` 50.0.0 resolves CVE-2026-69247.

The worker image now also requires its audited lockfile, installs it strictly,
and pins the `uv` installer image by version and digest. Dependency audits are
gating checks now that both ecosystems pass cleanly.

## v0.13.1-dev.1785801676 — 2026-08-03 · Dev

### ✨ Enterprise login with secure OIDC single sign-on

Voxen administrators can now configure instance-wide OpenID Connect providers from the dedicated **Admin → Authentication** page. Team members discover the correct provider from their email address and use the authentication policy already established for the platform.

The integration supports multiple verified domains and subdomains, preserves Voxen's account approval workflow, and keeps each user's workspace isolated. New federated accounts remain pending until an administrator approves them, while rejected or disabled accounts cannot create sessions.

Provider secrets are encrypted with the instance master key and never returned by the API. Voxen also requires PKCE and verified email claims, refuses unexpected identity-provider redirects, validates public HTTPS endpoints, and does not retain access, refresh, or ID tokens after authentication.

Administrators can rotate provider secrets without breaking linked accounts, safely remove a provider, and recover from an unreadable encrypted configuration by deleting and registering it again.

## v0.13.1-dev.1785776402 — 2026-08-03 · Dev

### 🛠️ Gate de migrations protege o histórico do banco

Pull requests agora preservam o histórico integrado do Prisma, exigem uma nova
migration ordenada para mudanças de schema e reproduzem toda a evolução em um
PostgreSQL isolado. O CI também detecta divergências em relação ao modelo atual
e publica diagnósticos sem credenciais para orientar a correção.

## v0.13.1-dev.1785771252 — 2026-08-03 · Dev

### 🧹 Quality Gate impede regressões graduais no código

O CI agora compara cobertura de testes, duplicação e tamanho de arquivos com
uma linha de base versionada. A catraca permite manter ou melhorar cada métrica,
mas bloqueia novas dívidas e publica um relatório detalhado para orientar a
correção automática da pull request.

## v0.13.1-dev.1785767741 — 2026-08-03 · Dev

### ✨ Personal classic and focused interface modes

- Added a per-user interface preference with the existing Voxen shell as the
  safe default.
- Added an opt-in focused desktop shell inspired by Vesper, where navigation
  belongs to the background canvas and the main content sits in one inset
  surface.
- Added accessible controls in the desktop sidebar, collapsed rail and personal
  account page.
- Kept mobile geometry unchanged and revalidate the preference when returning
  to a browser tab.

## v0.13.1-dev.1785764402 — 2026-08-03 · Dev

### 🎨 Administração e conta pessoal agora têm áreas próprias

A navegação separa claramente o trabalho na base, os dados da conta pessoal e a
configuração compartilhada da instância. Administradores entram em uma área
própria para modelos, integrações, usuários e custos, sem misturar esses controles
com as páginas comuns.

Cada usuário também passa a gerenciar seus próprios tokens MCP em **Conta →
Acesso MCP**, com segredo exibido uma única vez, permissões de leitura/escrita,
expiração opcional e revogação individual. A política de criação continua sob
controle do administrador.

## v0.13.1-dev.1785760507 — 2026-08-03 · Dev

### 🧹 Publicação do projeto passa a usar inglês e merges de release ficam limpos

As superfícies públicas do repositório passam a adotar inglês como idioma
principal. Releases estáveis também recebem um commit com somente `vX.Y.Z` no
assunto e corpo vazio, evitando que ferramentas de deploy exibam todo o
histórico da pull request.

## v0.13.1-dev.1785757969 — 2026-08-03 · Dev

### 🐛 Novidades passa a mostrar as releases de produção

A preparação de uma versão estável agora grava sua nota curada no feed de
**Novidades** antes da publicação. A versão `0.13.1` também foi recuperada no
histórico, e repetir o comando de preparação não duplica a mesma release.
O processo também interrompe a publicação sem alterar versões quando o arquivo
do histórico está ausente ou inválido.

## v0.13.1 — 2026-08-03 · Produção

### Voxen 0.13.1 — administração segura e processamento confiável

## Uma Biblioteca que se organiza com você

A Biblioteca agora deixa mais claro o que chegou nesta semana, o que ficou sem classificação e como cada conteúdo se relaciona com suas pastas e tags. Filtros visíveis, agrupamento semanal, Inbox e uma busca de tags que continua leve mesmo com uma Base de conhecimento maior ajudam a encontrar e organizar o conhecimento sem interromper o trabalho.

## Acesso mais rápido às áreas da Voxen

As telas secundárias passam a carregar sob demanda na web. A aplicação abre com menos código inicial, preservando a navegação, os controles de acesso e uma transição acessível enquanto cada área fica pronta.

## Brain mais confiável

O processamento de embeddings do Brain passou a respeitar a mesma coordenação usada na indexação. Isso evita concorrência entre tarefas de fundo e protege a Base de conhecimento quando uma atualização perde a posse do trabalho em andamento.

## Processamento que só termina quando está pronto

Um conteúdo não é mais apresentado como concluído enquanto ainda faltam resumo, tags ou processamento no Brain. Quando uma etapa de enriquecimento precisa de atenção, a Voxen mostra esse estado de forma explícita e permite retomar somente o que ficou pendente, sem repetir a transcrição ou o download original.

## Administração e privacidade por pessoa

Administradores agora contam com controles claros para aprovar, bloquear, reativar, promover ou remover usuários. As contas de plataformas, cookies e tokens pessoais permanecem isolados por usuário, e o bloqueio de uma conta invalida suas sessões ativas.

## Fontes que explicam o conhecimento

Conteúdos do YouTube preservam autor, endereço canônico e canal de origem. Essas referências acompanham o conteúdo até o Brain, deixando relações no grafo mais rastreáveis e fáceis de conferir.

## v0.13.1-dev.1785754177 — 2026-08-03 · Dev

### ✨ Jobs só concluem após todas as etapas e administração ganha controles de conta

Agora a fila mostra resumo, tags e conexão com o Brain como etapas reais antes de marcar um conteúdo como concluído. Quando uma etapa recuperável ficar pendente, o conteúdo continua acessível e recebe o status **Concluído com pendências**, com opção de repetir apenas essas etapas sem transcrever novamente.

Administradores também podem bloquear, reativar, promover, rebaixar e excluir contas. A exclusão exige digitar o e-mail exato e remove o workspace e as credenciais pessoais associadas. Conteúdos novos preservam URL canônica, canal e autor para melhorar suas conexões no grafo.

## v0.13.0-dev.1785737401 — 2026-08-03 · Dev

### ✨ Contas de plataforma agora são privadas por usuário

As sessões de TikTok, Instagram e YouTube passaram a ficar em **Contas de plataforma**, na área pessoal. Cada pessoa conecta a própria sessão pela extensão do Voxen e ela é usada somente nos seus processamentos.

A tela de Integrações administrativas ficou dedicada às configurações globais da instância. Também atualizamos os modelos padrão de Chat e Busca na web para DeepSeek V4 Flash, e os de Documentos e Visão para GPT-5.6 Luna.

## v0.13.0-dev.1785723415 — 2026-08-02 · Dev

### 🐛 Jobs em processamento se recuperam após reinícios

- Jobs em execução usam lease e heartbeat persistidos no Postgres.
- Um worker reiniciado recupera tentativas interrompidas sem deixar a Fila presa
  em 99%; após três interrupções, o job termina com uma mensagem recuperável.
- Conteúdo já persistido é retomado pelo checkpoint existente, sem criar uma
  segunda transcrição.
- Resumo, tags, embeddings e grafo não bloqueiam mais a conclusão canônica do
  job depois que o conteúdo foi salvo.
- Redis continua acelerando wakeups e progresso realtime, enquanto o Postgres é
  a fonte durável da fila.

## v0.13.0-dev.1785717760 — 2026-08-02 · Dev

### 🐛 Citações estáveis e páginas atualizadas ao retomar abas

Os previews das citações no Chat agora permanecem estáveis ao alternar o cursor
entre vários marcadores, sem piscar nem interferir nos links para as fontes.

Ao voltar para uma aba do Voxen, a página revalida seus dados silenciosamente.
O Chat também reconcilia o histórico com o servidor mesmo quando nenhuma
resposta está em andamento, refletindo alterações feitas em outra aba sem exigir
recarregamento manual.

## v0.13.0-dev.1785713547 — 2026-08-02 · Dev

### 🎨 Fontes e citações integradas ao Chat

Integra o painel de fontes ao layout do Chat e adiciona citações inline verificáveis às respostas.

## v0.13.0-dev.1785706085 — 2026-08-02 · Dev

### 🎨 Fontes do chat ficam mais fáceis de consultar e o Brain abre completo

As evidências de cada resposta agora aparecem em um resumo compacto e abrem um
painel lateral com fonte, trecho, localização e estado de verificação. O Brain
também passa a abrir diretamente na visão completa, sem exibir o bloqueio de
recorte.

## v0.13.0-dev.1785695013 — 2026-08-02 · Dev

### ✨ Artefatos de pesquisa agora preservam evidências navegáveis

Agora é possível criar briefing, FAQ, guia de estudo, linha do tempo e mapa
mental a partir de fontes escolhidas. Cada resultado mantém a fonte e o trecho
usado como evidência, respeita o espaço de trabalho de quem o criou e informa
quando alguma fonte selecionada está indisponível.

## v0.13.0-dev.1785692656 — 2026-08-02 · Dev

### ✨ Fontes web agora podem ser atualizadas sem perder o histórico

Páginas web da Base de conhecimento agora mostram quando foram coletadas e podem
ser atualizadas manualmente. Se nada mudou, o Voxen só registra a nova consulta;
se o conteúdo mudou, preserva a versão anterior, atualiza os índices e sinaliza
citações antigas para que não pareçam evidência da versão atual.

## v0.13.0-dev.1785690745 — 2026-08-02 · Dev

### 🧹 Base de testes passa a medir qualidade de busca e citações

O Voxen agora mantém um corpus sintético para comparar busca textual, híbrida e
Brain. Isso ajuda a evitar regressões de fontes e citações sem enviar dados ou
perguntas reais a serviços externos durante os testes.

## v0.13.0-dev.1785687938 — 2026-08-02 · Dev

### ✨ Busca encontra conteúdos por significado, não apenas por palavras-chave

Quando embeddings estão habilitados, a busca de transcrições combina palavras-chave
com a semelhança de significado dos conteúdos já compilados no Brain. Assim, uma
pergunta pode encontrar uma fonte mesmo usando termos diferentes dos originais.

Se o serviço de embeddings estiver indisponível, a busca continua funcionando com
o resultado textual tradicional.

## v0.13.0-dev.1785685922 — 2026-08-02 · Dev

### ✨ Relações verificáveis entre conhecimentos do Brain

O Brain agora registra suporte, contradição e aliases de entidades com trechos literais, linhas e timestamps da fonte. Ao consultar uma contradição, as evidências dos dois lados ficam disponíveis para conferência.

## v0.13.0-dev.1785684055 — 2026-08-02 · Dev

### ✨ Extração do Brain por seções com cobertura retomável

A extração grounded do Brain agora cobre conteúdos longos por seções e timestamps, preserva linhas de evidência e retoma apenas os segmentos pendentes ou que falharam.

## v0.13.0-dev.1785681907 — 2026-08-02 · Dev

### ✨ Citações verificáveis e clicáveis no chat

Respostas do chat agora persistem evidências validadas de forma determinística,
com fonte, trecho, localização e link navegável para a transcrição. Citações
sem validação não recebem selo de evidência.

## v0.13.0-dev.1785680287 — 2026-08-02 · Dev

### ✨ Tokens MCP individuais e revogáveis

O MCP agora usa tokens individuais por usuário, com escopos de leitura/escrita,
expiração, último uso e revogação. Administradores gerenciam metadados sem ver
segredos novamente e podem desativar a emissão de tokens por usuários.

## v0.13.0-dev.1785678128 — 2026-08-02 · Dev

### ✨ Saúde operacional da configuração de IA

Administradores agora veem quais capacidades de IA estão ativas, o modelo efetivo, modalidades, uso e custo agregados, revisão de configuração e falhas recentes. A tela também permite verificar uma finalidade sem criar conteúdo e simular a compatibilidade de um modelo antes da troca.

## v0.13.0-dev.1785674957 — 2026-08-02 · Dev

### 🐛 Validação dos modelos efetivos na troca de chave OpenRouter

Ao trocar a chave da OpenRouter, a Voxen agora confere os seis modelos efetivos — inclusive overrides — no catálogo autorizado da nova chave. Quando houver incompatibilidade, a tela informa a finalidade afetada e oferece alternativas compatíveis, sem alterar a configuração até a confirmação válida.

## v0.13.0-dev.1785673503 — 2026-08-02 · Dev

### ✨ Histórico auditável da configuração da instância

Administradores agora consultam revisões ordenadas da configuração global, com executor, data e diff legível. Chaves, tokens e cookies continuam redigidos no histórico. É possível restaurar valores permitidos em uma nova revisão, sem restaurar segredos, e novos jobs e turnos de chat passam a registrar a revisão de configuração vigente.

## v0.13.0-dev.1785672400 — 2026-08-02 · Dev

### 🧹 Matriz de regressão impede acesso cruzado entre usuários

O CI agora valida o isolamento de conteúdos, jobs, chat, Brain, eventos,
armazenamento e MCP entre usuários. Publicadores web e worker também recusam
progresso para jobs que não pertencem ao workspace informado.

## v0.13.0-dev.1785670528 — 2026-08-02 · Dev

### 🎨 Brain abre no mapa rápido 2D

O Brain agora abre no mapa 2D recortado e mantém o mapa completo como uma
escolha explícita. Ao explorar conexões, o painel também informa a relação,
método, confiança e origem da evidência.

## v0.13.0-dev.1785668893 — 2026-08-02 · Dev

### 🎨 Raciocínios longos acompanham a rolagem do chat

Quando a IA estiver mostrando um raciocínio longo antes da resposta final, o
chat agora acompanha o conteúdo novo automaticamente. Raciocínios curtos ainda
mantêm a pergunta visível, e uma rolagem manual continua sob seu controle.

## v0.13.0-dev.1785667820 — 2026-08-02 · Dev

### 🎨 Notas atualizadas ao abrir e visualizadas em Preview

A página de Notas agora atualiza sua lista ao abrir e quando você volta à aba,
mostrando sem recarregar manualmente as notas criadas pelo chat, MCP ou
automações.

As notas também abrem em **Preview**, com título e conteúdo protegidos contra
edição acidental. Use **Editar** para abrir os campos de alteração.

## v0.13.0-dev.1785664499 — 2026-08-02 · Dev

### ✨ Base de conhecimento unificada para chat e MCP

O chat e as integrações MCP agora consultam notas e transcrições na mesma busca,
priorizando notas curadas sem esconder fontes mais relevantes. As respostas podem
citar notas com links navegáveis e cada nota pode registrar múltiplas transcrições
de origem.

Também adotamos **Base de conhecimento** em português e **Knowledge base** em
inglês como a nomenclatura consistente de toda a aplicação.

## v0.13.0-dev.1785658852 — 2026-08-02 · Dev

### ✨ Após confirmar uma ação, a Vox continua a conversa — e você pode sempre permitir

Quando a Vox pede confirmação para criar uma nota e você confirma, ela volta a
responder e segue o plano — não para só com a mensagem de “nota criada”.

No card de confirmação há também **Sempre permitir**: a partir daí, criar nota
não pede confirmação de novo neste usuário. A preferência fica salva na sua
conta.

## v0.13.0-dev.1785656401 — 2026-08-02 · Dev

### 🎨 Atualização automática, notificações de job e toasts mais estáveis no PWA

No app instalado (PWA), a nova versão passa a ser aplicada sozinha ao abrir o app
quando o chat não está respondendo — sem o modal de atualização a cada deploy.

Quando uma transcrição termina ou falha com o app em segundo plano e as
notificações estão permitidas, o sistema mostra uma notificação com a identidade
da Voxen (em vez de só um aviso interno ao voltar para a aba).

Toasts antigos não ficam “presos” nem reaparecem em fila depois de muito tempo
com a aba em background. Na tela de detalhe de um job em andamento, a
transcrição pronta abre automaticamente ao concluir.

## v0.13.0-dev.1785574769 — 2026-08-01 · Dev

### 🎨 Os ícones animam ao passar o mouse no botão, e a barra estreita ganhou novidades e sair

Dois acabamentos de interface que apareceram no uso do dia a dia.

**O ícone agora anima pelo botão inteiro.** Antes, a animação de um ícone só
acontecia se o ponteiro passasse exatamente por cima do desenho — encostar no
botão que o contém não fazia nada, e em botão com texto ao lado ("Buscar na
biblioteca") o desenho quase nunca era tocado. Agora qualquer parte do botão,
link ou item de menu acende o ícone que ele contém, e passar direto no desenho
continua funcionando como antes. Atravessar do botão para o desenho não
reinicia nem interrompe a animação no meio: é um gesto só, do momento em que o
ponteiro entra ao momento em que sai.

Vale para o app inteiro — sidebar, barra do topo, cards da biblioteca, menus,
diálogos —, sem exceção por tipo de botão. **No celular nada muda**: toque não
é o mesmo que passar o mouse, e um toque não deixa mais o ícone parado no meio
do desenho.

**A barra estreita ficou completa.** Com a navegação recolhida, "Novidades" e
"Sair" simplesmente não existiam: para se desconectar era preciso abrir a
sidebar antes. Os dois agora fecham a barra estreita, no mesmo rodapé e na
mesma ordem da sidebar aberta, cada um com o nome aparecendo ao lado quando o
ponteiro para em cima. O "Sair" continua com o destaque avermelhado que avisa
que a ação desconecta — e esse aviso, que no tema claro ficava quase invisível,
voltou a ser legível nos quatro temas.

**Quem usa o sistema com movimento reduzido não vê animação nenhuma**, nem pelo
botão nem pelo ícone: a preferência do sistema continua desligando tudo.

## v0.13.0-dev.1785572765 — 2026-08-01 · Dev

### 🐛 O bloco "Pensando" para de abrir e fechar sozinho durante a resposta

Em turnos em que a Vox alterna entre escrever e consultar ferramentas, o bloco
**Pensando** abria e fechava a cada consulta, e o título trocava entre
"Pensando" e "Pensou por 12s · 3 ferramentas" no mesmo ritmo — empurrando a
conversa para cima e para baixo enquanto você tentava ler.

Agora o bloco abre uma vez quando o turno começa e recolhe uma vez, um instante
depois que a resposta termina; o título fica no shimmer "Pensando" durante todo
o turno e só vira o resumo no fim. E o bloco passou a ser clicável também
durante a resposta: se você abrir ou fechar na mão, ele fica exatamente como
você deixou — nada mais mexe nele sozinho, nem quando a conexão cai e volta.

Junto disso, o contador de versões `‹ 2/3 ›` das suas mensagens agora aparece e
some com o ponteiro, igual aos botões de copiar e editar da mesma linha, em vez
de ficar sempre na tela. Navegando pelo teclado, o contador continua acessível e
reaparece assim que uma das setas recebe o foco.

## v0.13.0-dev.1785569810 — 2026-08-01 · Dev

### 🛠️ CI mais rápido e extensão sob o mesmo padrão de formatação

O cache de build passou a ser separado por imagem também na publicação de
release e na varredura de segurança. Antes as duas imagens dividiam o mesmo
espaço de cache: na publicação uma sobrescrevia a da outra, e a varredura lia
de um espaço que ninguém preenchia. Nos dois casos cada execução recomeçava
quase do zero.

Os arquivos da extensão do navegador passaram a seguir o mesmo padrão de
formatação do resto do projeto, agora com verificação automática. Nada muda
no que a extensão faz — é organização de código.

## v0.13.0-dev.1785565397 — 2026-08-01 · Dev

### ✨ Editar uma pergunta do chat e navegar entre as versões dela

Agora dá para reescrever uma pergunta que você já enviou e recebê-la de volta
com uma resposta nova, sem perder a anterior. É a metade de cima do
versionamento de mensagens: a parte que aparece na tela.

**Como usar.** Passe o mouse por cima de uma mensagem sua e, ao lado do
"Copiar", aparece "Editar". A bolha vira uma caixa de texto já preenchida com o
que você escreveu, e o botão "Reenviar" manda a versão nova. Enter reenvia,
Shift+Enter quebra a linha e Esc fecha sem mandar nada.

**Reenviar não apaga nada.** A pergunta anterior e a resposta que ela recebeu
continuam guardadas. No ponto onde existe mais de uma versão aparece um
contador `‹ 2/3 ›` junto da mensagem, e as setas alternam entre elas — a
conversa inteira daquele ponto para a frente acompanha a versão escolhida.
Trocar de versão não gasta uma resposta nova: só mostra a que já existia.

**Reenviar o mesmo texto é válido.** Se você só quer outra tentativa da Vox,
mande a mesma pergunta de novo — vira uma versão como qualquer outra.

**Os anexos vêm junto.** Editar uma pergunta que tinha arquivo anexado mantém o
arquivo na versão nova, sem precisar subir de novo.

**Enquanto a Vox responde, os controles ficam travados.** Editar e trocar de
versão só voltam quando a resposta em andamento termina.

**Conversa sem versão nenhuma continua igual.** O contador só aparece onde
existe mais de uma versão, então quem nunca editou uma pergunta não vê nada de
novo além do botão "Editar".

## v0.13.0-dev.1785560565 — 2026-08-01 · Dev

### ✨ Chat preparado para versionar mensagens, com histórico preso à trilha em uso

A conversa do chat deixou de ser uma lista e passou a ser uma árvore. Isso é o
alicerce do versionamento de mensagens: em breve vai dar para editar uma
pergunta sua e reenviá-la como uma trilha nova, mantendo a resposta anterior
guardada e navegável em vez de perdida.

Esta entrega é a metade de baixo — a que garante que a coisa funcione certo.
Os botões de versionar e de navegar entre versões chegam na próxima.

**O que muda desde já.** Cada mensagem passa a saber qual veio antes dela, e a
conversa passa a lembrar em qual trilha você estava. Isso vale inclusive depois
de recarregar a página: a trilha volta como estava, não como "a mensagem mais
recente que existir no banco".

**O que a Vox lê continua sendo só o que você está vendo.** Todo lugar que monta
o histórico da conversa — a resposta que ela gera, a organização automática da
memória quando a conversa fica longa, a restauração da tela ao abrir o chat —
passou a percorrer exatamente a trilha em uso. Uma resposta de uma trilha
abandonada nunca entra no contexto sem você ver.

**Conversas antigas continuam intactas.** Nada precisa ser migrado e nada some:
uma conversa criada antes desta mudança é lida como sempre foi, de ponta a
ponta, e não ganha nenhum indicador de versão na tela.

**A memória longa também respeita a trilha.** Quando a conversa fica grande e a
Vox resume a parte antiga para caber no contexto, o resumo agora pertence à
trilha em que foi feito e continua no caminho certo do histórico.

## v0.13.0-dev.1785546542 — 2026-07-31 · Dev

### 🐛 Chat mostra o raciocínio, compacta as ferramentas e guarda os anexos da mensagem

Cinco acertos no chat, todos visíveis no uso do dia a dia.

**Raciocínio aparece de novo.** O texto de raciocínio que o modelo emite volta
a ser exibido na linha do tempo do turno, dentro do bloco "Pensando" (basta
expandir). Quando o modelo não emite raciocínio — ou só sinaliza a etapa sem
texto — o bloco continua mostrando o resumo operacional de sempre, sem espaço
vazio nem indicador travado.

**Ferramentas compactam assim que a resposta começa.** Antes o bloco de
ferramentas ficava aberto ocupando a tela até o fim do stream, empurrando a
resposta pra baixo justamente na hora de ler. Agora, no instante em que o
primeiro trecho da resposta final chega, o bloco se recolhe num resumo curto
("Pensou por 4,2s · 3 ferramentas") — e um clique reabre o detalhe. Se o agente
voltar a usar ferramentas depois disso, o bloco reabre sozinho.

**Documento anexado fica preso à mensagem.** O arquivo enviado pelo composer
continua indo para a Base de conhecimento, mas agora também fica vinculado à mensagem em que
foi enviado: os anexos aparecem logo abaixo da sua bolha no histórico e
continuam lá depois de recarregar a página. São até 5 anexos por mensagem.

Se o envio falhar — turno ocupado, limite de mensagens ou queda de conexão —
os anexos continuam no composer, prontos pra tentar de novo. Antes eles sumiam
e era preciso subir o arquivo outra vez.

**O composer cresce com o texto.** Escrever mensagens longas ficou confortável:
a caixa expande conforme você digita até uma altura máxima e só então passa a
rolar internamente. No celular esse teto acompanha a tela, então o teclado
aberto não engole a conversa.

**Ícone de enviar alinhado ao resto do app.** O avião de papel deu lugar ao
chevron, a mesma família de ícones usada em toda a interface. O chat do detalhe
de transcrição mantém o avião de propósito: ali o chevron já significa
expandir/recolher. Anexos de imagem também passam a mostrar ícone de imagem em
vez de ícone de documento.

## v0.13.0-dev.1785539796 — 2026-07-31 · Dev

### 🎨 Tema padrão agora se chama Voxen, e os ícones ganham vida ao navegar

O tema escuro padrão da aplicação passa a aparecer como **Voxen** no seletor de
tema (menu do avatar, no canto superior direito). Antes ele se chamava "Linear",
nome herdado da referência visual que inspirou a paleta — nada a ver com o
produto. Só o nome mudou: as cores são exatamente as mesmas, o tema continua
sendo o padrão de quem nunca escolheu outro, e quem já tinha algum tema salvo
continua exatamente com o que escolheu.

Os ícones também deixaram de ser estáticos em dois momentos:

- **Ao abrir uma página**, o ícone que identifica a página se desenha uma vez,
  junto com o conteúdo entrando.
- **Ao abrir ou fechar a sidebar** — e ao abrir o menu no celular —, os ícones
  de navegação se desenham em cascata, acompanhando o painel.

A animação é curta e deliberadamente contida — só esses dois momentos, para
pontuar a navegação sem virar ruído. Quem usa o sistema com "reduzir movimento"
ativado não vê nenhuma dessas animações.

## v0.13.0-dev.1785537512 — 2026-07-31 · Dev

### ✨ Conectar contas de TikTok, Instagram e YouTube pela extensão

Vídeo que só baixa com login — TikTok, Instagram, YouTube com restrição de
idade — agora tem um caminho de verdade: a extensão do Voxen conecta a conta.

Nas opções da extensão apareceu a seção **Contas de plataforma**, com um
botão "Conectar" para cada uma das três. Faça login no site normalmente, no
mesmo perfil do browser, clique em Conectar e pronto: a extensão pede a
permissão daquele site na hora, pega a sessão e envia cifrada para a sua
instância. Nada de exportar `cookies.txt` na mão nem instalar extensão de
terceiro.

A permissão é pedida por site, uma de cada vez, e só no momento do clique —
a extensão não ganha acesso a nenhum outro site. O valor da sessão nunca é
exibido de volta, nem na extensão nem no Voxen.

Em **Integrações** (admin) há um painel de estado mostrando quais plataformas
estão conectadas, quando foram conectadas e quais podem já ter expirado —
sessões passam a ser sinalizadas como "possivelmente expiradas" depois de 7
dias, e basta reconectar pela extensão. O botão "Desconectar" apaga a sessão
guardada a qualquer momento.

Conectar uma plataforma não mexe nas outras: cada uma é substituída
isoladamente.

## v0.13.0-dev.1785537512 — 2026-07-31 · Dev

### 🐛 Conteúdo em markdown renderizado, reprocessar direto da fila e campo de link em destaque

Quatro correções no dia a dia de capturar e ler conteúdo.

**Análises em markdown voltam a aparecer formatadas.** Posts do X analisados por
IA (e qualquer conteúdo sem marcação de tempo) eram exibidos pelo leitor de
transcrição, que junta tudo num parágrafo só e mostra `##` e `**` crus. Agora a
página escolhe o modo de exibição pelo próprio conteúdo: com marcações de tempo,
segue a leitura por trechos clicáveis; sem elas, renderiza markdown com títulos,
listas, tabelas e negrito.

**Reprocessar item da fila.** Itens que falharam ou foram cancelados agora têm um
botão de reprocessar na própria fila — não é mais preciso recolar o link. Se o
conteúdo já estiver em processamento, já tiver sido indexado ou o servidor
recusar, o motivo aparece num aviso e o item continua como estava.

**Campo de colar link com destaque.** O placeholder longo com exemplos de URL deu
lugar a um "Cole o link aqui" direto, e o campo ganhou superfície elevada, borda
mais forte e realce de foco — é a ação principal da tela de conteúdo.

**Linha do tempo do job alinhada.** Os marcadores de cada etapa no histórico de um
job agora ficam centrados na linha vertical que os conecta.

## v0.13.0-dev.1785534442 — 2026-07-31 · Dev

### 🐛 Extensão mantém o progresso do envio ao fechar e reabrir o popup

Fechar o popup da extensão não perde mais o acompanhamento do envio. Antes, o
progresso vivia só na janelinha aberta: bastava clicar fora para o Chrome
descartar tudo e, ao reabrir, a extensão mostrava a tela inicial mesmo com a
transcrição rodando.

Agora, ao reabrir o popup:

- **Envio em andamento** volta com a barra de progresso e a etapa real
  (baixando, transcrevendo, gerando resumo…), além do botão "Ver na fila".
- **Envio que terminou com o popup fechado** aparece com o resultado — resumo e
  botão para abrir o conteúdo, ou a mensagem de erro se falhou. O resultado é
  mostrado uma vez; depois disso o popup volta ao normal.
- **Instância fora do ar ou sem rede** avisa que o acompanhamento está
  indisponível no momento, sem sumir com o envio nem fingir que terminou — e
  sem travar o botão: não saber em que pé está o envio anterior não impede
  mandar a próxima página. Isso vale também para instância que fica pendurada
  em vez de recusar a conexão: agora toda requisição tem prazo, então um
  backend travado atrás de um proxy de pé não deixa mais o botão preso em
  "Salvo — processando".
- **Acompanhamento que nunca resolve** (instância trocada nas opções, job
  apagado no servidor) é descartado depois de algumas horas em vez de ficar
  para sempre. O prazo conta a partir da última vez em que o servidor
  confirmou o envio em andamento, e não do momento do envio: fila cheia com
  vários vídeos longos à frente não faz mais o último da fila perder a
  notificação por tempo de espera.

Também nesta entrega, acabamento da extensão: cantos mais arredondados no
popup, página de conexão reorganizada em duas colunas (cabe sem rolagem, com o
bloco "Token Bearer" separado das ações principais por um divisor) e ícones da
barra do Chrome regerados a partir da arte em alta resolução, agora centrados e
mais nítidos em 16 px.

## v0.13.0-dev.1785524483 — 2026-07-31 · Dev

### ✨ Escolha manual de modelo por finalidade nas integrações admin

A configuração da OpenRouter continua exigindo só a chave no onboarding,
mas agora o admin pode sobrescrever individualmente o modelo usado em cada
uma das 6 finalidades (chat, transcrição, busca na web, visão, documentos
e análise do X) em **Integrações**.

A nova seção mostra o modelo padrão e o override ativo de cada finalidade,
com um diálogo de busca sobre o catálogo da sua chave OpenRouter — a lista
já vem filtrada pelos modelos compatíveis com aquela finalidade (ex.: só
modelos com suporte a imagem aparecem na finalidade de visão). Tentar
escolher um modelo incompatível é bloqueado com uma mensagem explicando o
motivo, e um botão "Voltar ao padrão" remove o override a qualquer
momento. Trocar a chave da OpenRouter não apaga overrides já configurados.

## v0.13.0-dev.1785522932 — 2026-07-31 · Dev

### 🎨 Extensão de browser redesenhada com a identidade visual do Voxen

O popup e a página de opções da extensão de browser agora usam os mesmos
tokens de cor e a mesma tipografia do Voxen web (Bricolage Grotesque + Inter,
temas padrão/zinc/emerald/light) — antes a extensão tinha uma paleta
verde/indigo própria, sempre escura, desconectada do resto do produto.

- **Tema segue a instância conectada**: se você já tem um tema escolhido no
  Voxen (`Conta → Aparência`), a extensão aplica o mesmo tema assim que
  detecta a instância — tanto no popup quanto na página de opções. Sem
  instância conectada ainda, ela segue o esquema claro/escuro do sistema
  operacional.
- **Uma única tela de conexão**: a página de opções (`chrome-extension://.../options.html`)
  passa a ser a única superfície onde a extensão se conecta a uma instância
  Voxen. O popup não reimplementa mais esse formulário — quando ainda não há
  instância conectada, ele mostra um estado vazio com um botão que abre as
  opções, eliminando a duplicação de fluxo entre popup e opções.
- **Progresso mostra a etapa real**: enquanto um job está processando, o
  popup exibe a etapa atual (baixando, transcrevendo, gerando resumo…) em vez
  de um "Processando…" genérico, sempre que o status do job traz essa
  informação.
- Todos os estados existentes (detecção de instância, envio de aba,
  progresso, resultado com resumo, ações pós-envio) continuam disponíveis —
  nenhuma capacidade foi removida, só reorganizada.

## v0.13.0-dev.1785520081 — 2026-07-31 · Dev

### 🐛 Busca na Base de conhecimento quebrava o turno inteiro do chat

Corrigido bug que fazia o agente de chat falhar sempre que usava a ferramenta de busca na Base de conhecimento (`search_transcripts`) — um campo de data era devolvido em formato incompatível com o que o modelo de IA espera, derrubando a resposta inteira com erro técnico. O mesmo problema foi corrigido no servidor MCP.

## v0.13.0-dev.1785517091 — 2026-07-31 · Dev

### 🐛 Retry com impersonate=chrome do TikTok nunca era acionado

Corrigido bug de controle de fluxo que fazia a mitigação de retry do TikTok (forçar impersonation de browser via `curl_cffi` quando o download falha com "unable to extract universal data for rehydration") nunca ser executada — o erro já virava falha permanente antes do retry ter chance de rodar. O TikTok está passando por uma instabilidade conhecida e ainda não corrigida no `yt-dlp` upstream; esse retry agora funciona de verdade e recupera parte dos downloads que antes falhavam de cara.

## v0.13.0-dev.1785440574 — 2026-07-30 · Dev

### 🐛 Cabeçalhos, chat e atualização novamente consistentes

As páginas operacionais agora começam logo após o cabeçalho flutuante e usam um
padrão único de título, descrição, identificação da área e ícone colorido
animado. A página da extensão também passa a aproveitar a mesma largura das
demais telas.

O histórico do chat volta a acompanhar a largura do campo de mensagem, e o
botão de envio mostra um pictograma de envio claro. O modal de nova versão deixa
de desenhar uma moldura roxa ao redor de todo o conteúdo quando recebe foco.

## v0.13.0-dev.1785431966 — 2026-07-30 · Dev

### 🐛 Rótulos legíveis ao explorar o Brain

O hover dos nós do Grafo agora usa uma superfície compatível com o tema ativo,
mantendo título e fundo com contraste adequado no modo escuro. Títulos muito
longos também são limitados para não atravessarem toda a visualização.

## v0.13.0-dev.1785429740 — 2026-07-30 · Dev

### 🐛 Interface mais estável, legível e consistente

A navegação entre telas deixa de exibir conteúdo da rota anterior ou saltar o
scroll durante a troca. O carregamento preserva o shell da aplicação, e as
páginas operacionais passam a aproveitar melhor a largura disponível sem
alongar excessivamente textos de leitura.

No mobile, o menu lateral mantém animação, foco, sombra e bloqueio da página
sincronizados até o fim do gesto. O editor de notas reorganiza título, status e
ações para manter Preview e Salvar acessíveis em telas estreitas; `/` e `/chat`
também passam a compartilhar o mesmo comportamento de navegação.

O Grafo ganha contraste confiável ao passar o mouse ou selecionar nós, resumo
sem marcadores Markdown crus e preparação antecipada do modo 3D. No chat, a
timeline mostra estados operacionais seguros, preserva durações concluídas e
oferece mais espaço para tabelas e outros dados estruturados.

O aviso de nova versão ganhou uma área maior e rolável com cabeçalho e ações
sempre visíveis. Detalhes da fila e a página de novidades receberam correções
de hierarquia e navegação.

Por fim, instruções e comentários indevidos deixam de virar tags. Rótulos
históricos conhecidos são saneados no deploy e conteúdos que ficarem sem tags
voltam automaticamente ao processamento idempotente.

## v0.13.0-dev.1785406211 — 2026-07-30 · Dev

### 🐛 Configuração simples e interface estável no uso diário

A configuração da OpenRouter passa a pedir somente a chave de API e aplica
automaticamente os modelos recomendados para conversa, análise e transcrição.
O processamento continua especializado por formato: PDFs usam o parser Mistral,
outros documentos usam MarkItDown e imagens, áudio e vídeo seguem pela
OpenRouter.

Notificações agora aparecem uma por vez durante cinco segundos. A Fila mantém
os dados visíveis e reconcilia mudanças em segundo plano, sem trocar a lista por
skeletons periódicos nem reiniciar itens que não mudaram.

No mobile, gestos horizontais em tabelas, conteúdos roláveis e no canvas do
Grafo não abrem mais a sidebar, e o menu fechado não deixa sombra na lateral.
A atualização da aplicação também passa a respeitar a versão exata do build,
inclusive quando um service worker já está aguardando, e só ativa a nova versão
quando a pessoa confirma.

## v0.13.0-dev.1785376533 — 2026-07-29 · Dev

### 🐛 Atualizações deixam de prender a interface antiga

O aviso de nova versão passa a usar a versão exata do pacote e prepara a
atualização do app em segundo plano. Navegações online deixam de reutilizar o
HTML antigo do PWA, evitando que uma interface desatualizada continue ativa
depois de um deploy.

O modal mantém cabeçalho e ações sempre acessíveis e concentra a rolagem em uma
única região central, inclusive quando as notas da versão são extensas.

## v0.13.0-dev.1785366299 — 2026-07-29 · Dev

### 🐛 Atualizações e páginas com comportamento consistente

O aviso de nova versão agora mostra somente as notas da versão correta, mantém
cabeçalho e ações visíveis e permite rolar todo o conteúdo central por mouse,
trackpad, toque ou teclado. Carregamento, indisponibilidade e falha possuem
estados próprios, e adiar não é mais confundido com aplicar a atualização.

As páginas de conteúdo passaram a compartilhar larguras, margens e ritmo
vertical adequados a cada tipo de trabalho, aproveitando melhor a tela e
evitando mudanças bruscas de tamanho durante a navegação.

O chat também informa o início do preparo imediatamente, executa etapas
independentes em paralelo e registra separadamente o tempo interno e a espera
pelo primeiro evento do modelo.

## v0.13.0-dev.1785359396 — 2026-07-29 · Dev

### ✨ Superfícies mais claras, fluidas e prontas para uso

A navegação mobile deixa de repetir “Início” e passa a abrir um menu lateral
parcial que acompanha o gesto da borda ou do centro da tela, com foco contido,
fechamento acessível e respeito a movimento reduzido.

As telas de processamento agora descrevem a etapa real de vídeos, páginas,
documentos, imagens e conteúdo do X, preservam o histórico recebido em tempo
real e mostram a duração de cada fase sem redirecionar antes da conclusão.

O Brain passa a ser reconciliado mesmo sem visitas ao Grafo. Novos conteúdos
invalidam o snapshot e atualizam a página aberta em tempo real; o Grafo inicia
sempre na visualização completa e mantém os títulos legíveis no tema escuro.

Novidades ganhou fluxo contínuo, busca, filtros e paginação. O aviso de nova
versão ficou maior, explica a mudança de versão e oferece acesso direto ao
histórico completo. O onboarding continua simples, enquanto a configuração
avançada dos modelos permanece disponível para administradores.

## v0.13.0-dev.1785355315 — 2026-07-29 · Dev

### ✨ Interface mais clara, densa e consistente

A Voxen ganhou uma nova fundação visual inspirada nos princípios de hierarquia
e foco do Linear. O tema escuro principal, a sidebar mais confortável, os
ícones animados e os novos layouts reutilizáveis aproveitam melhor a tela sem
adicionar ruído.

As transições também respeitam a preferência de movimento reduzido, e a
navegação mobile mantém o drawer leve e sem destinos redundantes.

## v0.13.0-dev.1785351539 — 2026-07-29 · Dev

### ✨ OpenRouter pronta para uso com uma única chave

O onboarding agora pede somente a chave da OpenRouter e configura
automaticamente os modelos recomendados para conversa, transcrição, imagens,
documentos, pesquisa e conteúdo do X. O administrador continua podendo trocar
cada modelo depois na página de Configuração.

PDFs passam a usar o parser Mistral OCR pela OpenRouter. A geração automática de
tags também ficou mais confiável: respostas estruturadas evitam tags vazias e
conteúdos incompletos entram numa reconciliação em segundo plano, com tentativas
limitadas e diagnóstico preservado.

## v0.13.0-dev.1785340742 — 2026-07-29 · Dev

### ✨ Chat mobile e ingestão de links mais confiáveis

- Melhora a abertura do menu no mobile, a biblioteca de notas e as telas de atualizações.
- Mostra o andamento real de transcrições e análises, inclusive após reconectar a página.
- Trata links enviados no chat de acordo com a intenção: processa quando solicitado e pede esclarecimento quando necessário.

## v0.13.0-dev.1785219429 — 2026-07-28 · Dev

### 🐛 Chat mais estável, rápido e confiável

O chat agora descreve corretamente o que está fazendo antes de responder, prepara em paralelo
as informações independentes de que precisa e mede o tempo de raciocínio desde o início real da
solicitação.

Também corrigimos a confirmação de criação de notas, inclusive para os identificadores usados
pelo provedor de IA, e reduzimos remontagens e movimentos involuntários da conversa durante
respostas e recuperações.

## v0.13.0 — 2026-07-27 · Produção

### Voxen 0.13.0 — Biblioteca Viva e conhecimento que acompanha seu ritmo

## Uma Biblioteca que se organiza com você

A Biblioteca agora deixa mais claro o que chegou nesta semana, o que ficou sem classificação e como cada conteúdo se relaciona com suas pastas e tags. Filtros visíveis, agrupamento semanal, Inbox e uma busca de tags que continua leve mesmo com um acervo maior ajudam a encontrar e organizar o conhecimento sem interromper o trabalho.

## Acesso mais rápido às áreas da Voxen

As telas secundárias passam a carregar sob demanda na web. A aplicação abre com menos código inicial, preservando a navegação, os controles de acesso e uma transição acessível enquanto cada área fica pronta.

## Brain mais confiável

O processamento de embeddings do Brain passou a respeitar a mesma coordenação usada na indexação. Isso evita concorrência entre tarefas de fundo e protege o acervo quando uma atualização perde a posse do trabalho em andamento.

## v0.12.0-dev.1785168327 — 2026-07-27 · Dev

### 🔒 Atualização de segurança nos componentes internos da Voxen

Atualizamos dependências internas usadas pela Voxen para versões com correções de segurança. A experiência de uso permanece a mesma, com uma base mais protegida para capturas, Biblioteca, chat e administração.

## v0.11.0-dev.1785165340 — 2026-07-27 · Dev

### 🐛 Brain mantém embeddings consistentes durante atualizações

Quando os embeddings opcionais são atualizados, a Voxen agora coordena essa escrita com a atualização do Brain. Isso evita que um embedding concorra com a reconstrução do mapa de conhecimento do mesmo usuário.

Se a coordenação estiver ocupada ou indisponível, o embedding é ignorado com segurança e pode ser atualizado em uma próxima execução, sem deixar o Brain em estado parcial.

## v0.11.0-dev.1785163369 — 2026-07-27 · Dev

### ⚡ Telas mais rápidas ao navegar pela Voxen

Chat, Biblioteca, Notas, Grafo, Automações e Administração passam a ser preparados somente quando você abre cada área. Isso reduz o trabalho do primeiro acesso, especialmente em conexão móvel e no app instalado.

Ao trocar de tela, a navegação continua visível e a área de conteúdo mostra um indicador de carregamento acessível enquanto a página é preparada.

## v0.11.0-dev.1785161161 — 2026-07-27 · Dev

### ⚡ Biblioteca encontra tags grandes sem pesar no celular

A Biblioteca passa a carregar só as tags mais relevantes na tela inicial. Ao abrir o seletor, você pode buscar uma tag e carregar mais resultados sem trazer o catálogo inteiro para o celular.

Isso mantém a organização por tags rápida mesmo quando a base de conhecimento cresce, preservando os filtros combinados de pasta, Inbox, semana, status e busca.

## v0.11.0-dev.1785159812 — 2026-07-27 · Dev

### ✨ Biblioteca Viva organiza conteúdos por semana, Inbox, pastas e tags

A Biblioteca agora separa os conteúdos por semana de captura e permite reduzir a Base de conhecimento pela semana atual ou anterior. O Inbox destaca materiais que ainda não entraram em uma pasta, enquanto pastas e tags aparecem como filtros visíveis com contagem de conteúdos.

As combinações de busca, período, pasta, tag e status permanecem na URL para que uma organização possa ser compartilhada ou retomada. A Vox também recebe a pasta, tags e data de captura nos resultados da Biblioteca, deixando suas sugestões e leituras de contexto mais situadas.

## v0.11.0-dev.1785155159 — 2026-07-27 · Dev

### ✨ Voxen fica mais confiavel como app no celular

O Voxen agora oferece instalacao como app no Android e instrucoes claras para adicionar ao Inicio no Safari do iPhone/iPad. A experiencia instalada acompanha melhor o tema escolhido e deixa de travar a orientacao da tela em retrato.

Atualizacoes aguardam o fim de respostas em andamento antes de recarregar, preservando a sessao e o cache do app. Quando a conexao cai, a tela informa o problema e permite tentar novamente, sem tratar uma falha temporaria como logout.

Tambem ampliamos os alvos de toque no celular e melhoramos a acessibilidade dos dialogos de Automacoes, incluindo foco e fechamento por teclado.

## v0.11.0-dev.1784459422 — 2026-07-19 · Dev

### ✨ Extensão v0.2 — design, resumo do job e conexão em um clique

A extensão de browser ganhou visual moderno, detecção automática da
instância aberta, acompanhamento do processamento com notificação e
resumo quando o conteúdo fica pronto, além de aviso de atualização
consultando a própria instância.

## v0.11.0-dev.1784455991 — 2026-07-19 · Dev

### ✨ Extensão Chromium sideload para capturar a aba atual

Nova extensão Manifest V3 (Chrome/Edge/Brave) que envia a URL da aba para
`POST /api/jobs/auto` da instância configurada, com página `/extensao` na
sidebar para baixar o ZIP e instruções de instalação sideload.

## v0.11.0-dev.1784454827 — 2026-07-19 · Dev

### 🛠️ Deploy no Easypanel só no commit de versão (mensagem limpa)

O script de deploy manual só aceita HEAD no formato
`set version to X.Y.Z-dev.<timestamp>` — o mesmo padrão do Orbital, em que o
deploy roda depois do version-dev. Assim o log do Easypanel deixa de mostrar
o body inteiro da PR de feature e passa a mostrar só a linha de versão.

## v0.11.0-dev.1784451878 — 2026-07-19 · Dev

### 🐛 Capas estáveis no S3 e deploy Easypanel só manual

Capas de vídeo/página (especialmente TikTok) deixam de apontar para CDN
assinada no navegador: na ingestão a imagem é espelhada no storage e a
UI usa só `/api/transcripts/:id/preview` (com placeholder se a CDN já
tiver bloqueado). Também dá para pedir `POST .../refresh-thumbnail`.

O script de deploy do Easypanel agora exige `VOXEN_ALLOW_DEPLOY=1` —
sem isso não dispara redeploy (auto-deploy desligado de verdade).

## v0.11.0-dev.1784450551 — 2026-07-19 · Dev

### 🎨 Fonte original sob o título e grafo com núcleo centralizado

Na página do conteúdo, o link da origem (YouTube, TikTok, web…) fica logo
abaixo do título, clicável e legível. Na lista, o host da fonte aparece
junto dos metadados.

No grafo, a maior comunidade (concentração de ligações) fica no centro da
cena; a câmera abre e reenquadra nesse núcleo. As cores dos títulos dos
nós ganharam mais contraste (texto + contorno) no 2D e no 3D.

## v0.11.0-dev.1784447963 — 2026-07-19 · Dev

### 🔒 Atualizações de segurança em dependências transitivas

Corrige alertas do Dependabot em dependências de build e do worker:

- `shell-quote` 1.8.4 (crítico, dev)
- `js-yaml` 4.2.0 e `@babel/core` 7.29.6 (tooling)
- `aiohttp` ≥ 3.14.1 no worker (transitiva do S3/scraper)

## v0.11.0-dev.1784447963 — 2026-07-19 · Dev

### 🛠️ Higiene open-source e mensagens mais claras no guard de changelog

Removemos referências internas de lab da documentação de fluxo e dos
comentários de deploy, e o CI agora explica com mais clareza o que falta
quando uma PR não inclui o arquivo de changelog.

## v0.11.0-dev.1784444893 — 2026-07-19 · Dev

### 🧹 Deploy manual e commits de versão limpos em dev

- Imagem Easypanel deixa de ser publicada em todo push de `dev` (só tag de release ou `workflow_dispatch`).
- Bump de versão em dev passa a commitar/squashar como `set version to X.Y.Z-dev.<ts>` (sem `chore:`/`for dev`/`(#N)` no subject do squash).
- Script de deploy Easypanel documentado como manual (sem hook pós-pull).

## v0.11.0-dev.1784443300 — 2026-07-19 · Dev

### ✨ Reprocessar só o cérebro no grafo (sem gastar IA nem mexer no conteúdo)

- Botão “Reprocessar cérebro” no `/grafo` com confirmação clara do que muda.
- Reconstrói o mapa a partir do que já está salvo; não regenera tags, resumos nem extract LLM.
- Preserva arestas `llm-grounded` e manuais no reprocesso heurístico.

## v0.11.0-dev.1784440910 — 2026-07-19 · Dev

### ✨ Compile grounded no Brain, clusters no mapa e embeddings opt-in

- Após a ingestão, extrai entidades e claims com trecho literal (grounding) via OpenRouter.
- Mapa rápido passa a mostrar hubs de comunidade (clusters) para grupos com 3+ nós.
- Embeddings opcionais no metadata do conteúdo, com reordenação híbrida na busca FTS quando habilitados.

## v0.11.0-dev.1784437723 — 2026-07-19 · Dev

### ✨ Mapa do Brain rápido (2D padrão, recorte e arestas fortes)

- Abre o grafo em 2D por padrão e só carrega 3D sob demanda.
- `GET /api/graph?view=map` devolve um recorte enxuto (≤180 nós); `view=full` e `focus` cobrem o restante.
- Omite arestas fracas de co-ocorrência no mapa e eleva o limiar de RELATED_TO no indexador.
- Documenta LangExtract (padrão de grounding, sem a lib) e a estratégia do mapa em ADRs.

## v0.11.0-dev.1784433253 — 2026-07-19 · Dev

### 🐛 Chat não cai mais com network error ao transcrever links

- Mantém o stream SSE vivo durante transcrições longas (keepalive + idleTimeout do Bun).
- Desconexões de transporte recuperam o turno em andamento sem toast de network error.
- Rate limit do YouTube em legendas volta a cair no Whisper em vez de falhar o job.
- Filtra tags geradas com raciocínio do modelo (ex.: "Looking at the content").

## v0.11.0-dev.1784197604 — 2026-07-16 · Dev

### 🐛 Chat resiliente e experiência mobile contínua

- Mantém respostas longas em execução mesmo quando o PWA perde a conexão e retoma turnos após reinícios.
- Continua a resposta final depois que a transcrição de um link termina, sem deixar o chat preso.
- Abre conversas extensas com paginação, melhora áreas seguras e formulários mobile e estabiliza o foco do grafo 3D.

## v0.11.0-dev.1784187494 — 2026-07-16 · Dev

### 🎨 Conversas mais discretas e sem atalhos fora de hora

O botão **Ir ao mais recente** agora aparece somente depois que você se afasta
intencionalmente do fim da conversa. Ele não surge mais ao abrir um chat novo,
durante o pensamento da Vox nem por causa do posicionamento automático das
mensagens.

Na página de uma transcrição, o campo contextual de conversa virou um dock fino:
uma faixa de 32 px permanece visível e o compositor completo se abre com hover,
foco ou toque. Rascunhos mantêm o dock aberto, e o envio com `Enter` continua
levando a pergunta para o chat canônico com o contexto da transcrição.

## v0.11.0-dev.1784187494 — 2026-07-16 · Dev

### 🐛 Brain 3D estável, centralizado e mais fácil de navegar

O Brain deixa de alternar indefinidamente entre passes de indexação incompatíveis:
o indexador rápido agora preserva a versão completa já registrada, enquanto o
passe completo também reconhece a cobertura mínima atendida. Isso evita ciclos de
**Organizando** e falhas de cobertura em conteúdos que já foram processados.
O estado completo só é registrado depois que fontes, pastas, conceitos e relações
terminam; se uma etapa falhar, a fonte continua pendente para uma nova tentativa.
Web e worker agora compartilham uma única trava distribuída por workspace: eles
não reescrevem o mesmo Brain ao mesmo tempo, e uma indisponibilidade temporária
mantém o snapshot atual em vez de iniciar trabalho concorrente. Mudanças de fonte
e nós órfãos também são detectados e reconciliados automaticamente. Um heartbeat
renova a trava durante passes longos sem adicionar uma chamada Redis a cada etapa.

No modo 3D, a maior comunidade passa a ocupar o centro real da cena e é o foco do
primeiro enquadramento. Comunidades menores ficam distribuídas ao redor do núcleo,
com controles separados para aproximar, afastar, focar o núcleo e mostrar todo o
grafo.

## v0.11.0-dev.1784146544 — 2026-07-15 · Dev

### ⚡ Brain 3D abre com estabilidade e permanece centralizado

O mapa do Brain agora acompanha a indexação por um status leve, sem baixar e
reconstruir todos os nós e relações repetidamente. O trabalho é coordenado no
Redis e pode ser retomado com segurança após reinícios, enquanto falhas reais
param o ciclo e oferecem uma tentativa explícita em vez de carregar para sempre.

A distribuição 3D também passa a nascer centralizada na origem, reenquadra a
câmera quando a topologia muda e usa cores compatíveis com o renderer, reduzindo
travamentos e avisos repetidos durante a navegação.

## v0.11.0-dev.1784133009 — 2026-07-15 · Dev

### ⚡ Brain 3D persistente e fluido

O Voxen Brain volta a abrir diretamente em 3D com um layout tridimensional
determinístico, adaptativo e sem simulação contínua. O renderer permanece
montado durante interações e atualizações, evitando o acúmulo de contextos
WebGL. A rotação volta a responder diretamente ao gesto, o contexto prioriza
desempenho e o fallback 2D cobre ausência ou falha de WebGL2 sem quebrar com
tipos semânticos de nós.

## v0.11.0-dev.1784126586 — 2026-07-15 · Dev

### ⚡ Grafo do Brain mais rápido e explorável

# Grafo do Brain mais rápido e explorável

- A visão 2D passa a abrir primeiro, com o modo 3D carregado somente quando
  solicitado.
- A página ganha filtros, hubs, comunidades, inspeção de nós e controles de
  navegação organizados em uma interface compatível com todos os temas.
- A atualização do Brain deixa de bloquear a resposta enquanto reindexa e
  passa a informar o progresso automaticamente.
- A conversa canônica passa a tolerar a disputa de criação observada pela
  suíte concorrente do CI.

## v0.11.0-dev.1784083142 — 2026-07-14 · Dev

### 🎨 Detalhe da transcrição com copiar resumo e barra de chat

Página de conteúdo ganha botão de copiar o resumo, promptbox sticky no estilo do
chat (Enter envia e abre a conversa com o contexto do item) e hierarquia visual
mais limpa.

## v0.11.0-dev.1784081644 — 2026-07-14 · Dev

### ✨ Tags geradas automaticamente ao adicionar links e conteúdos

O worker passa a criar tags por IA após o resumo de cada job (vídeo, web, upload,
X). Conteúdos novos deixam de chegar sem tags; falhas de tag não derrubam o job.

## v0.11.0-dev.1784081644 — 2026-07-14 · Dev

### ✨ Fuso horário da instância e relógio da Vox no chat

Configuração IANA de fuso no onboarding, em Configurações e em Admin → Usuários.
A cada turno o agente recebe data/hora local, dia da semana, offset e marcos UTC
para “hoje” / “esta semana” sem adivinhar o fuso do servidor.

## v0.11.0-dev.1784078888 — 2026-07-14 · Dev

### 🐛 Âncora da mensagem no topo não some na primeira ferramenta

O reengage do stick-to-bottom só ocorre com espaçador esgotado e após
começar o texto final da resposta (ou ao fim do turno). Tools e raciocínio
sozinhos não desancoram a mensagem enviada.

## v0.11.0-dev.1784078888 — 2026-07-14 · Dev

### 🐛 Vox deixa de falar em nomes de ferramentas pro usuário

O system prompt proíbe citar tools, parâmetros e IDs internos na resposta
final. Próximos passos passam a ser em linguagem natural de produto.

## v0.11.0-dev.1784078888 — 2026-07-14 · Dev

### 🐛 Bloco Pensando deixa de piscar entre ferramentas

O bloco de raciocínio do chat fica aberto enquanto o turno está ao vivo
(`live`) e só recolhe quando o stream termina — gaps entre tool-results
não colapsam mais a timeline.

## v0.11.0-dev.1784074880 — 2026-07-14 · Dev

### 🐛 Erro de ferramenta deixa de travar o chat em “Pensando…”

Falhas de tool (ex.: transcrição) passam a marcar erro de verdade, curam
estados `running` órfãos e mostram fallback legível. O status inicial do
turno agora é “Buscando na sua biblioteca…”.

## v0.11.0-dev.1784073052 — 2026-07-14 · Dev

### 🎨 Chat ancora a mensagem enviada no topo e deixa espaço para a resposta

Ao enviar uma mensagem, a bolha do usuário sobe para o topo da área do chat
(estilo ChatGPT/Orbital) e a resposta nasce no espaço abaixo. Um espaçador
encolhe durante o stream para evitar saltos; rolar para cima cancela o
acompanhamento automático.

## v0.11.0-dev.1784071986 — 2026-07-14 · Dev

### ✨ Agente lista a Base de conhecimento por data de ingestão (resuma minha semana)

Novas tools `list_transcripts` e `list_notes` com `since`/`until` em `createdAt`.
Perguntas como “resuma minha semana” passam a listar o intake real da janela
antes de ler e sintetizar — sem depender só de busca por termo.

## v0.11.0-dev.1784065901 — 2026-07-14 · Dev

### 🐛 Chat deixa de quebrar no AI SDK 7 com histórico SYSTEM

Conversas com resumo de compactação ou resposta HITL voltam a responder
normalmente. O runtime passa a permitir mensagens SYSTEM confiáveis do
servidor no `streamText` e a compactação usa `instructions` em vez de
`system`.

## v0.11.0-dev.1784065901 — 2026-07-14 · Dev

### 🎨 Chat mais calmo no markdown, com copiar mensagem e chrome mobile transparente

Links e código inline nas respostas da Vox deixam de aparecer como badges
fortes. Dá para copiar a mensagem do usuário ou da IA pelo botão abaixo do
texto. No celular, o cabeçalho fica transparente e do mesmo tamanho do botão
da sidebar, com o histórico passando por baixo.

## v0.11.0-dev.1784062200 — 2026-07-14 · Dev

### 🐛 Confirmações antigas de nota voltam a funcionar ou somem do chat

Pedidos de criação de nota feitos antes da pausa HITL — que apareciam no card
acima do prompt mas falhavam com “não encontrada ou já utilizada” — agora são
recuperados a partir do conteúdo ainda salvo na mensagem, ou o card é removido
quando a confirmação já tinha sido usada.

## v0.11.0-dev.1784061257 — 2026-07-14 · Dev

### 🐛 Confirmação de nota antiga deixa de ficar presa no chat

Ao confirmar uma proposta de nota que ficou pendente sob muitas respostas
posteriores da IA, o card de confirmação agora some corretamente. Antes, só as
últimas mensagens eram atualizadas e o pedido podia reaparecer como se ainda
estivesse aberto.

## v0.11.0-dev.1784059366 — 2026-07-14 · Dev

### ✨ Confirmação da IA pausa o chat e fica acima do prompt

Quando a Vox propõe criar uma nota, o turno agora pausa de verdade em vez de continuar “pensando” em volta do botão. O pedido de confirmação aparece logo acima da caixa de mensagem, sobrevive se você sair e voltar depois, e não expira por tempo. No celular, os botões do cabeçalho direito ficam do mesmo tamanho do botão que abre o menu.

## v0.11.0-dev.1783971428 — 2026-07-13 · Dev

### 🐛 Chat quebrava para sempre após aprovar criação de nota via IA

Corrigido crash que derrubava o chat inteiro (tela "Algo deu errado") sempre que uma conversa com uma confirmação de nota aprovada era carregada. A causa era um dado malformado gravado na mensagem de confirmação, que o render de ferramentas não conseguia interpretar. Também foi adicionada uma validação de segurança para que dados malformados (deste ou de qualquer bug futuro) nunca mais consigam quebrar o chat inteiro — são simplesmente ignorados no render.

## v0.11.0-dev.1783967660 — 2026-07-13 · Dev

### 🛠️ Script de deploy automático no Easypanel pós-merge

Adicionado `scripts/easypanel-deploy.sh`: dispara o redeploy do `voxen-app` no Easypanel quando a `dev` avança para um SHA ainda não implantado, idempotente (marcador em disco evita redeploy duplicado do mesmo commit), com modo `--dry-run` e retentativa curta em falha transitória do Easypanel. O script não contém nenhuma credencial — a API key vem do ambiente. A configuração do gatilho (hook local que chama este script após cada merge) é feita separadamente, fora do controle de versão.

## v0.11.0-dev.1783913992 — 2026-07-13 · Dev

### ✨ Vox pesquisa, conecta e preserva melhor o contexto

O chat agora mantém o raciocínio visível depois de recarregar a página, pesquisa
a web e o X com os modelos configurados e procura automaticamente conteúdos
relacionados na Biblioteca antes de responder. Ao receber uma URL, a Vox aguarda
a ingestão e trabalha com resumo, tags e relacionados, abrindo a transcrição
completa somente quando necessário.

As pastas geradas por tags passam a exibir todo conteúdo associado, inclusive
quando um item possui várias tags. O MCP também entrega resumos e tags e orienta
agentes externos com o mesmo fluxo rico de recuperação, verificação e segurança.

## v0.11.0-dev.1783912875 — 2026-07-13 · Dev

### 🎨 Navegação mobile mais compacta

O cabeçalho flutuante e o botão que abre a navegação lateral agora ocupam menos
espaço em telas pequenas. Controles, avatar, margens e sombra foram suavizados
no mobile, mantendo a aparência atual do desktop.

## v0.11.0-dev.1783910846 — 2026-07-12 · Dev

### 🐛 Atualizações automáticas passam por todos os checks da PR

O bump de desenvolvimento agora reexecuta CI, segurança e validação de changelog
no contexto da própria PR. Isso permite publicar a nova versão e suas novidades
sem deixar o rollup preso em aprovação manual.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Novidades voltam a acompanhar cada atualização de desenvolvimento

O pipeline de versão agora substitui bumps obsoletos, executa os checks no build
correto e publica todas as notas acumuladas. A página Novidades e o modal de update
deixam de ficar presos em uma versão antiga após novos deploys.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Agente in-app ganha ferramenta para enfileirar transcrição de links compartilhados

O agente respondia que não tinha acesso à internet e não conseguia abrir links quando o usuário colava uma URL do YouTube, X ou qualquer página — apesar do Voxen ser justamente uma plataforma de ingestão de links. A causa era a falta de uma ferramenta de enfileiramento: o agente só enxergava tools de leitura sobre o que já estava transcrito na Base de conhecimento. Agora ele também tem `request_transcription` (enfileira a URL nova, ou aponta direto a transcrição já existente) e `get_job_status` (acompanha o job até concluir), espelhando o par que o servidor MCP já usava para agentes externos.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Chat e outras telas não arrastam mais na horizontal no celular

Em telas menores, algumas áreas do app podiam ser arrastadas para os lados —
principalmente o chat, quando o resumo de uma ferramenta, um erro ou a própria
mensagem colada continha um link, token ou ID longo sem espaços, que esticava o
balão além da largura da tela em vez de quebrar linha.

Corrigimos os pontos de origem (detalhe de ferramenta e bolha de mensagem do
chat, mensagem de erro de execução de automações, corpo de notas de release no
modal de atualização e em "Novidades") e reforçamos como cinto de segurança os
principais containers de rolagem do app — conteúdo das páginas, modais e
diálogos — para nunca abrirem rolagem lateral, mesmo diante de um texto sem
quebra.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Grafo (/grafo) redesenhado para celular — controles, câmera 3D e visualização

A página do Grafo (Brain) tinha vários problemas específicos de celular, agora corrigidos:

- **Barra de controles menos poluída**: no celular, as estatísticas do grafo (transcrições,
  notas, pastas, conceitos, conexões) saem da fileira principal — que antes quebrava em
  várias linhas — e vão para um botão de informação dedicado, que abre um painel só com
  elas. Busca, alternância 2D/3D e atualizar continuam sempre visíveis, sem disputar espaço.
- **Câmera 2D por padrão no celular**: o grafo agora abre em modo 2D (arrastar move a
  câmera) em telas estreitas, em vez de 3D (arrastar gira a câmera) — girar com o dedo é um
  gesto ruim em touchscreen. No desktop o padrão continua 3D. O botão de alternar 2D/3D
  continua disponível nos dois casos.
- **Visualização sem WebGL adaptada à tela**: quando o navegador não suporta WebGL (fallback
  final, sem o grafo 3D nem o 2D acelerado), o desenho agora se ajusta à proporção real da
  tela em vez de assumir sempre paisagem — evita faixas vazias grandes em cima/embaixo em
  telas retrato (a maioria dos celulares).
- **Nós um pouco maiores em telas touch**: o alvo de toque mínimo dos nós do grafo aumenta
  em dispositivos touch, facilitando selecionar itens pequenos com o dedo.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Indicador de ambiente substitui o alternador manual de canal em Novidades

A página Novidades tinha três botões (Todas/Produção/Dev) que pareciam alternar entre ambientes,
mas na verdade só filtravam o histórico de notas — a instância nunca trocava de canal, sempre
mostrava o mesmo `releases.json` da imagem atual. Esses botões saíram e o histórico completo passa
a aparecer direto, sem filtro manual. No lugar, um indicador simples e não-clicável no topo da
página mostra em qual ambiente a instância atual está rodando — Desenvolvimento ou Produção —
derivado da versão real reportada pelo servidor, sem depender de escolha manual do usuário.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Fileira de pastas da Biblioteca não quebra mais com muitas pastas

Com as tags geradas por IA criando uma pasta automática para cada tag, o número de pastas
na Biblioteca cresceu rápido e a fileira de chips de pasta passou a quebrar em várias linhas,
ficando visualmente poluída. Agora a fileira mostra só as primeiras pastas (até um limite fixo)
e, quando há mais, um chip final "+K mais" abre um popover com busca — digite para filtrar por
nome entre todas as pastas e clique para selecionar, igual a um chip normal. Continua tudo como
antes: contagem de conteúdos por pasta, criação de pasta nova e destaque da pasta ativa (mesmo
quando ela está fora das primeiras exibidas).

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Raciocínio da Vox corrigido e unificado com as ferramentas

O raciocínio da Vox (o "pensando" que aparece antes da resposta) agora é enviado
corretamente para o modelo — o parâmetro que pedia esforço de raciocínio estava no
formato errado para o OpenRouter e vinha sendo descartado silenciosamente pelo SDK,
o que fazia o raciocínio aparecer de forma inconsistente.

Na interface, raciocínio e ferramentas agora vivem dentro de um único bloco
"Pensando" / "Pensou por Xs", em vez de duas caixas separadas (raciocínio sempre
em cima, ferramentas sempre embaixo). Com o agente rodando várias etapas de
raciocínio intercaladas com buscas e leituras, o bloco agora mostra tudo na ORDEM
real em que aconteceu — cada nova ferramenta ou novo trecho de raciocínio aparece
na posição cronológica certa, então dá pra acompanhar o trabalho acontecendo em
tempo real em vez de ver uma caixa de raciocínio parada no topo enquanto o resto
roda embaixo, sem relação visual entre os dois.

Também corrigimos o botão "Ir ao mais recente" (aparecia esticado e mal
centralizado por um bug de CSS) e trocamos o ícone de enviar mensagem de avião de
papel para uma seta para cima.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Menu lateral recolhido por padrão, cabeçalho flutuante e chat como tela inicial no celular

O menu lateral agora abre recolhido (só ícones) por padrão em todas as páginas do
desktop — antes isso só acontecia no chat. Expandir fica salvo até você recolher de
novo. O cabeçalho também virou um bloco flutuante no canto superior direito, do
tamanho dos botões, e passou a aparecer no celular também (antes só existia no
desktop). E no celular, a tela inicial agora é o chat — igual ao desktop —, sem a
barra de navegação embaixo do campo de mensagem; pra acessar biblioteca, notas e
demais páginas, use o novo botão no canto superior esquerdo.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Consistência de tema em toda a aplicação (light legível, cards corretos)

Corrigimos textos ilegíveis e cards "cinzas fora do tema" no modo claro (e por tabela nos
temas escuros). Dezenas de telas usavam cores fixas que não trocavam junto com o tema —
agora todas usam os tokens semânticos do design system, então texto, superfícies e bordas
acompanham o tema ativo (zinc, emerald ou light). Também ajustamos o título de destaque, os
cards elevados e o fundo ambiente para deixarem de escurecer o tema claro.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Chat repaginado e ajustes de shell

O chat ganhou uma cara nova e profissional: bloco de ferramentas que mostra
"Trabalhando" com contador enquanto roda e colapsa num resumo (nº de ações,
famílias e duração) ao terminar, com cada ação abrindo o detalhe; raciocínio em
tempo real com efeito "Pensando" que vira "Pensou por Xs" recolhível; e um novo
composer com anexo de arquivos (imagem, áudio/vídeo e documentos entram direto na
Base de conhecimento), estado do envio em chip e envio por Enter. O chat abre já no fim da
conversa e a barra de rolagem fica na borda da tela, com o conteúdo centralizado.

No shell, os botões de som e de limpar conversa passaram para o cabeçalho, ao lado
do avatar (só no chat), a sidebar recolhida no chat virou um rail de ícones com
atalhos e dica no hover, e o item "Início" saiu da navegação do desktop (onde a
tela inicial já é o chat).

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### ✨ Tags de conteúdo geradas por IA na biblioteca

A biblioteca ganhou tags geradas por IA: a partir do título e do resumo/texto, o modelo atribui tags reaproveitando as já existentes (sem duplicar) e cada tag também cria/reaproveita uma pasta de mesmo nome. Um conteúdo pode ter várias tags, o que melhora a organização, a busca e a ligação entre conteúdos — a busca da biblioteca passa a casar por tag além do texto. Há botão para gerar tags de um conteúdo e para processar em lote os que ainda não têm tag.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### ✨ Harness de recuperação progressiva do agente

O agente in-app e o servidor MCP ganharam recuperação progressiva estilo editor de código com IA: busca textual forte (FTS), leitura de estrutura (outline), leitura por intervalo de linhas, por seção e por intervalo de timestamps, expansão de contexto anterior/posterior, busca de conteúdos relacionados e verificação determinística de citações. O fluxo evita mandar transcrições inteiras ao modelo — busca primeiro, abre só os trechos necessários e cita documento, linhas/seção e timestamp. Sem embeddings.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Chat redesenhado, temas e nova organização da home

O chat ganhou empty state no estilo SuperGrok, composer fixo, bloco de ferramentas/raciocínio mais limpo e botão para limpar a conversa com confirmação irreversível. A aplicação passa a ter temas zinc (padrão), emerald e light — selecionáveis no menu do usuário, com atalho claro/escuro no cabeçalho — e a preferência fica salva na conta. No desktop, `/` abre o chat; no mobile a home fica enxuta, o envio de links/arquivos vai para a Biblioteca e a fila de jobs ganha a rota `/fila`.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### ✨ Chat Vox persistente com ferramentas e memória resumida

O Vox passa a funcionar em uma única conversa contínua por conta. As respostas chegam em streaming, exibem raciocínio, fontes e chamadas de ferramentas, e podem pesquisar transcrições, notas e o Brain com isolamento por usuário. Quando o histórico fica longo, ele é resumido automaticamente sem perder o contexto recente. Ações de escrita em notas são propostas e só são executadas após aprovação explícita, e os sons de feedback são opcionais.

## v0.11.0-dev.1783824951 — 2026-07-11 · Dev

### 🎨 Home alinhada à Biblioteca

A Home agora usa a hierarquia visual compacta da Biblioteca. Os itens da fila podem ser selecionados por toda a linha: conteúdos concluídos abrem sua transcrição e os demais abrem o detalhe do processamento.

## v0.11.0-dev.1783821598 — 2026-07-12 · Dev

### 🎨 Erros de carregamento com "tentar novamente" e foco de teclado visível

Quando uma página falha ao carregar (rede ou servidor), em vez de mostrar um
estado "vazio" enganoso ela agora exibe um aviso claro de erro com um botão
**Tentar novamente**. E vários botões (abas, filtros de pasta, alternadores e o
fechar de modais) passaram a mostrar um anel de foco ao navegar por teclado,
melhorando a acessibilidade.

## v0.11.0-dev.1783821598 — 2026-07-12 · Dev

### ✨ Liga/desliga do Agente de Proxy com um switch

O Agente de Proxy residencial (que roteia a extração de mídia pelo seu IP de
casa quando o YouTube bloqueia downloads de datacenter) ganhou um **switch de
ativar/desativar** em Admin → Integrações. Desligar faz o servidor voltar a
baixar direto, sem apagar o token nem exigir reinstalar o agente — é só religar
o switch para voltar a rotear pelo agente.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### ✨ Regenerar títulos de toda a Base de conhecimento com IA

Novo botão **Regenerar títulos** na biblioteca: reescreve com IA os títulos de
todos os conteúdos, drenando a Base de conhecimento em lotes. Útil depois das melhorias na
geração de título (sempre em português, sem vazar o "raciocínio" do modelo) —
conteúdos antigos com título ruim são atualizados; os que já estão bons são
mantidos. Consome créditos de IA (uma chamada por conteúdo).

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🧹 Simplificação das configurações da instância

Removidas duas seções de configuração que vão deixar de ser necessárias com o
amadurecimento da plataforma: a seção **"Operação da instância"** (email do
operador e timeout de resumo) na tela de configuração, e a seção **"Cookies do
yt-dlp"** em Integrações. A extração de mídia segue funcionando normalmente.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Grafo do Brain volta a ter 3D (com alternância 2D/3D)

O grafo do Brain volta a ser exibido em **3D** por padrão — dá para orbitar
arrastando e ver as conexões com profundidade, com o layout se acomodando de
forma animada. Um botão na barra do grafo alterna entre **3D** e **2D** a
qualquer momento, e a dica de controles se adapta ao modo escolhido.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Títulos deixam de vazar o "raciocínio" do modelo

Alguns conteúdos (posts do X, páginas web) recebiam como título o preâmbulo do
modelo — coisas como "The candidate title is…" ou "The user wants a final
title…", às vezes truncadas no meio. Agora a geração de título desabilita o
modo de raciocínio do modelo e rejeita qualquer resposta que pareça preâmbulo,
caindo no título original quando isso acontece.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Confirmações no tema do app e skeletons alinhados

As confirmações de ações destrutivas (apagar todas as pastas, cancelar um job)
deixaram de usar o pop-up nativo do navegador — agora abrem um modal de
confirmação no visual do Voxen, com botão destacado e spinner enquanto processa.
Os placeholders de carregamento (skeletons) passaram a usar a cor de superfície
do tema, combinando melhor com os cards.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Aviso de nova versão vira um modal com o que mudou

Quando sai uma versão nova enquanto você está usando o Voxen, no lugar do
antigo aviso discreto no canto agora aparece um **modal centralizado** — mostra
a versão nova, um resumo do que mudou (puxado das Novidades) e os botões para
recarregar na hora ou deixar para depois.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Grafo carrega sem travar (fim do erro 502)

Abrir o grafo do Brain deixou de recalcular a base inteira de forma síncrona
dentro da requisição — o que, em bibliotecas grandes, travava por dezenas de
segundos e resultava em erro 502. Agora a página responde na hora com o estado
atual e, quando há muito conteúdo para reindexar, o recálculo roda em segundo
plano; o grafo se atualiza sozinho no próximo carregamento.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Títulos gerados sempre em português

Quando o idioma da instância é português, o título automático de um conteúdo em
outro idioma (ex.: um vídeo do YouTube em inglês) agora é **traduzido/adaptado
para o português**, em vez de ser mantido no idioma original. Títulos que já
estão em português e são bons continuam sendo preservados.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Mensagem clara quando o proxy de download está fora do ar

Quando o download é roteado por um proxy (ex.: o Agente de Proxy residencial) e
esse proxy está indisponível, o job falhava com um erro técnico cru de "conexão
recusada". Agora a falha traz uma mensagem acionável: avisa que o proxy está
fora do ar e orienta a verificar o Agente de Proxy em Admin → Integrações, ou a
ajustar/remover o proxy para baixar direto pelo servidor.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Grafo do Brain mais leve e fluido

A visualização do **Voxen Brain** (`/grafo`) passou a usar a Reagraph, um
motor WebGL 2D. O grafo fica mais limpo e fácil de navegar (pan e zoom diretos,
destaque de vizinhança ao passar o mouse, clique para selecionar e duplo-clique
para abrir o item). O motor pesado é carregado só ao abrir a página, deixando o
resto do app mais rápido para carregar. Quando o navegador não tem WebGL, o
grafo continua caindo no desenho 2D determinístico de sempre.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Botão de Novidades na barra lateral

O rodapé da barra lateral deixou de exibir o número da versão e do commit. No
lugar entra um botão claro de **Novidades**, com ícone, que leva direto à página
de novidades ao clicar. Fica mais óbvio que dá para abrir o histórico de
mudanças, sem poluir o menu com informação técnica de build.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Grafo mais estável e limpar pastas sem erro 502

O reindex do Brain deixa de quebrar com erros de chave estrangeira sob carga
(reconciliação em paralelo). Apagar todas as pastas responde na hora — a limpeza
do grafo roda em background, sem estourar o proxy.

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🐛 Versionamento em dev via PR (compatível com branch protection)

O bump automático `X.Y.Z-dev.timestamp` agora abre uma PR de versão e usa
auto-merge, respeitando a proteção da branch `dev` (sem push direto).

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🐛 Correção do detector de PR de versão aberta

O workflow de versionamento em dev não criava a PR de bump porque a busca
de PRs abertas era ampla demais. Agora só considera títulos que começam com
`chore: set version to `.

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🛠️ Versionamento automático em dev e changelog por PR

A cada merge em `dev`, o Voxen agora grava a versão no `package.json` no formato
`X.Y.Z-dev.<timestamp>` (commit `chore: set version to … for dev`), no mesmo
estilo da Orbital.

Além disso, cada PR de produto passa a incluir um arquivo em
`changelog/unreleased/` com a nota para o usuário final. No merge, a nota entra
em `releases.json` e no `CHANGELOG.md` — base da página de Novidades.

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### ✨ Página de Novidades com o histórico de versões

Nova página **/novidades** na aplicação, acessível pelo rodapé da sidebar
(versão clicável). Lista as notas de changelog de dev e produção geradas
automaticamente a partir das PRs, com filtros por canal.

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🎨 Biblioteca mais compacta, pastas e paginação

A página de **Transcrições** ficou mais densa e fácil de escanear:

- Cards em **lista minimalista** (thumb pequena, meta numa linha)
- Pastas em chips (Todas / Sem pasta / pastas) com visual mais limpo
- Botão **Apagar pastas** remove a organização sem apagar conteúdos — libera o Organizar com IA de novo
- **Carregar mais** com paginação real na API (24 itens por página)

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🐛 Correção do workflow de versionamento em dev

O commit automático de versão em `dev` (`X.Y.Z-dev.timestamp`) volta a funcionar —
o arquivo do workflow tinha um erro de YAML no filtro do commit do bot.
