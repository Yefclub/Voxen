# Spec 016 — Extração de Mídia Simplificada e Foco em Home-Lab

## Contexto

Em 2025-2026 o YouTube apertou bloqueios contra IPs de datacenter (provedores
de VPS/cloud). A spec 015 introduziu seis configurações de mitigação na tela de
Setup (cookies, User-Agent, player clients, PO Tokens, PoT provider URL,
proxies). Esse conjunto de configurações:

- Aumenta a complexidade percebida pelo operador self-hosted.
- Pode levar ao banimento de contas Google quando cookies são extraídos de
  conta pessoal e usados em servidor cloud.
- Não resolve o problema raiz, que é o IP de origem ser marcado pelo YouTube.

Voxen é self-hosted single-tenant. Em deploy em hardware residencial
(home-lab), o IP de origem é residencial e o bloqueio do YouTube praticamente
não ocorre. Esta spec reverte cinco das seis configurações de extração,
mantém apenas o proxy (opcional, controlado pelo operador) e reposiciona
home-lab como o cenário recomendado primário na documentação e UI.

Referência: ADR-004 (agente sem embeddings) segue intacta. Esta spec
modifica decisões operacionais da spec 015, não decisões arquiteturais.

## Glossário

- **Home-lab**: deploy em hardware residencial (mini-PC, NAS, Raspberry Pi)
  com IP residencial fornecido por ISP doméstico.
- **Setting global**: linha na tabela `Setting` com escopo `GLOBAL`, valor
  cifrado pela master key.
- **Bloqueio do YouTube**: erros do extractor `yt-dlp` em que o YouTube
  retorna mensagens do tipo "Sign in to confirm you're not a bot", "Use
  --cookies-from-browser", etc.
- **Setting legada**: linha persistida no DB para uma chave que não é mais
  consumida pelo código após esta spec.

## Requisitos

### Ubiquitous

- The system shall support `yt-dlp` downloads with at most one
  YouTube-specific configuration: an optional list of proxy URLs
  (`yt_dlp_proxy_urls`).
- The system shall present home-lab deployment as the primary recommended
  scenario in `README.md` and `docs/DEPLOY.md`.
- The system shall preserve the manual file upload flow
  (`UPLOAD_AND_TRANSCRIBE`) as the universal fallback for any failed external
  download.

### Event-driven

- When the YouTube extractor reports a bot-detection error (matched by
  substrings such as "sign in to confirm", "not a bot",
  "cookies-from-browser", "cookies for the authentication"), the system shall
  return a user-facing message that contains all of:
  - a clear statement that the download was blocked by YouTube;
  - instruction to upload the file manually;
  - mention that an administrator can configure a residential proxy;
  - a link or path reference to documentation explaining why VPS deployments
    are vulnerable.
- When an administrator submits the Setup configuration form, the system
  shall accept and persist only `yt_dlp_proxy_urls` among the previously
  defined YT-DLP extraction keys.

### State-driven

- While the worker builds `yt-dlp` runtime options for a download job, the
  system shall read at most one extraction setting (`yt_dlp_proxy_urls`) and
  shall ignore any persisted values for removed keys.

### Optional

- Where the administrator has configured one or more entries in
  `yt_dlp_proxy_urls`, the system shall select one entry at random for each
  download attempt.

### Unwanted

- If a legacy setting row exists in the database for one of the removed keys
  (`yt_dlp_cookies_txt`, `yt_dlp_user_agent`, `yt_dlp_youtube_clients`,
  `yt_dlp_youtube_po_tokens`, `yt_dlp_pot_provider_url`), then the system
  shall not read or apply it; the row may remain in place but must be inert.
- If an older client sends a payload containing a removed field on the Setup
  PATCH endpoint, then the system shall silently ignore the unknown field
  rather than rejecting the request.
- If no proxy URLs are configured and the YouTube extractor returns a
  bot-detection error, then the system shall surface the user-facing message
  defined under Event-driven and shall not retry with alternative clients,
  cookies, or tokens.

## Critérios de Aceite

- [ ] Apenas o getter `get_yt_dlp_proxy_urls` permanece no módulo de settings
      do worker; os getters dos cinco campos removidos foram apagados.
- [ ] A função que monta opções de runtime do `yt-dlp` aplica apenas proxy
      (quando configurado) e as opções base (retries, geo_bypass, timeouts).
- [ ] Helpers de parsing de player clients e PO tokens foram removidos do
      worker.
- [ ] O endpoint de Setup (GET e PATCH) expõe e aceita apenas
      `yt_dlp_proxy_urls` entre as chaves de extração YT-DLP.
- [ ] A página de Setup exibe um único campo "Proxy de extração (opcional)"
      na seção de extração de mídia, acompanhado de nota recomendando
      home-lab.
- [ ] A mensagem retornada pelo worker em casos de bloqueio do YouTube
      atende ao requisito Event-driven (estado, upload manual, proxy,
      link/path para docs).
- [ ] `docs/DEPLOY.md` apresenta os cenários na ordem: Home-lab (recomendado)
      → VPS (com aviso explícito sobre bloqueio do YouTube) → Híbrido
      (avançado).
- [ ] `README.md` destaca home-lab como cenário recomendado para deploy.
- [ ] `make lint`, `make typecheck`, `make test` e `docker compose build` dos
      serviços afetados (web, worker) executam com sucesso.

## Fora de Escopo

- Migration SQL para deletar linhas órfãs da tabela `Setting` (rows ficam
  inertes; limpeza opcional pode vir em spec separada).
- Detecção automática de ambiente VPS para banner contextual.
- Integração com `bgutil-ytdlp-pot-provider` (não será adicionado).
- Integração com Cobalt como alternativa de download.
- Extensão de browser para download client-side.
- Lembretes ou UI dedicada a rotação de cookies (cookies foram removidos).
- Modificações no fluxo de upload manual existente.

## Riscos / Decisões pendentes

- Risco: deploys atuais em VPS que dependem dos cinco campos removidos verão
  downloads pararem de funcionar até que o operador (a) instale proxy
  residencial, ou (b) migre para home-lab, ou (c) use upload manual.
  Mitigação: changelog destacando a mudança e mensagem de erro educativa
  orientando próximos passos.
- Decisão tomada (registrada): cookies do YouTube foram removidos apesar de
  resolverem casos legítimos em home-lab (vídeos de membros, idade
  restringida). Trade-off aceito em favor de simplicidade e mitigação de
  risco de banimento.
- Decisão tomada (registrada): User-Agent customizado removido por baixo
  valor agregado fora do contexto de bypass.
