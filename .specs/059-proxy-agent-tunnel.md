# 059 — Agente de Proxy (túnel residencial) — runtime do servidor chisel

## Contexto

Em deploys self-hosted onde o Voxen roda numa VPS de datacenter, o YouTube e
outras plataformas frequentemente bloqueiam downloads vindos de IPs de
datacenter. A solução é rotear o tráfego de extração de mídia por um **agente
residencial** (IP residencial controlado pelo operador) via um túnel reverso
(chisel). O agente residencial abre o túnel para o Voxen e expõe um proxy que o
worker usa.

Para o agente residencial se conectar ao Voxen, ele precisa autenticar com um
**token de conexão** de alta entropia. Este token é gerado/gerenciado pelo admin
na UI e fica cifrado no DB (como os demais secrets de runtime).

**Escopo desta entrega (Fase 2).** A Fase 1 (spec 058) cobriu a app web:
gerenciamento do token, persistência cifrada, endpoint admin de status e a UI com
snippet. **Esta fase** sobe o **servidor chisel embutido na imagem combinada
`voxen-app`** e o amarra ao token: authfile gerado pela app web a partir do
`proxy_agent_token`, recarga via SIGHUP, e roteamento automático do worker pro
SOCKS local do túnel. O **status real da conexão** do agente continua fora do
escopo (placeholder de R2.2 permanece).

## Glossário

- **Agente de Proxy**: container residencial (chisel client + proxy) que o
  operador roda na rede de casa.
- **Token de conexão**: segredo de alta entropia usado pelo agente para
  autenticar no túnel. Único por instância no MVP.
- **URL do túnel**: endpoint público onde o agente conecta o túnel reverso.

## Requisitos (EARS)

### R1 — Geração do token

- **R1.1** WHEN um admin solicita a geração de um token de proxy, THE sistema
  SHALL gerar um token de alta entropia (>= 32 bytes aleatórios, codificado em
  base64url) e persistir o token **cifrado** no setting `proxy_agent_token`.
- **R1.2** WHEN o token é gerado ou rotacionado, THE sistema SHALL retornar o
  token em **texto puro UMA única vez** na resposta da operação, junto com a URL
  de conexão do túnel.
- **R1.3** THE sistema SHALL sobrescrever qualquer token existente ao gerar um
  novo (rotação = gerar por cima).

### R2 — Status (sem vazar segredo)

- **R2.1** WHEN um admin consulta o status do agente de proxy, THE sistema SHALL
  retornar se há token configurado (`configured: boolean`) e a URL de conexão do
  túnel, mas **NUNCA** o token (nem cifrado, nem em texto puro).
- **R2.2** THE sistema SHALL incluir um campo `agentStatus` indicando o estado da
  conexão do agente. Nesta entrega o valor é um placeholder
  (`'unknown'` quando há token, `'not_configured'` quando não há); o status real
  da conexão chega na PR do runtime.

### R3 — Revogação

- **R3.1** WHEN um admin revoga o token, THE sistema SHALL remover o setting
  `proxy_agent_token`.
- **R3.2** WHILE não há token configurado, THE sistema SHALL reportar
  `configured: false` e `agentStatus: 'not_configured'`.

### R4 — Segurança / Admin-only

- **R4.1** THE sistema SHALL restringir todos os endpoints de proxy-agent a
  usuários com role `ADMIN` (derivada da sessão, NUNCA do body/query); não-admin
  recebe 403 e não-autenticado recebe 401.
- **R4.2** THE sistema SHALL NUNCA logar o token (texto puro ou cifrado).
- **R4.3** THE sistema SHALL NUNCA reexibir o token após a geração — só permite
  rotacionar (gerar novo) ou revogar.

### R5 — UI admin

- **R5.1** THE UI admin SHALL exibir uma seção "Agente de Proxy" com o estado
  (configurado / não configurado).
- **R5.2** WHEN o admin gera/rotaciona o token, THE UI SHALL exibir o token UMA
  vez com botão de copiar e aviso de que não será mostrado novamente.
- **R5.3** THE UI SHALL exibir a URL de conexão e um **snippet de instalação**
  do agente (docker run) com a URL e o token embutidos enquanto o token está
  visível; depois de o token sumir, o snippet usa o placeholder `<TOKEN>`.
- **R5.4** THE UI SHALL oferecer botão de revogar (com confirmação) quando há
  token configurado.
- **R5.5** THE UI SHALL traduzir todos os textos nos dois locales (pt-BR e en).

### R6 — Servidor chisel embutido (Fase 2)

- **R6.1** THE imagem `voxen-app` SHALL conter o binário do chisel 1.11.5
  (release oficial PINADO, verificado por SHA256) em `/usr/local/bin/chisel`.
- **R6.2** WHEN o container inicia, THE entrypoint SHALL iniciar o chisel server
  em modo `--reverse` na porta de controle `CHISEL_PORT` (default 8088),
  registrando o PID em `CHISEL_PIDFILE`, com um authfile inicial vazio (`{}`).
- **R6.3** IF o chisel falhar ao iniciar, THE entrypoint SHALL logar e seguir —
  o boot dos 3 serviços core (web/chat/worker) e as migrations NÃO dependem dele.
- **R6.4** THE porta de controle SHALL ser publicada via domínio TLS no deploy
  (fora desta PR); o SOCKS reverso (`127.0.0.1:1080`) NUNCA é publicado.

### R7 — Authfile dirigido pelo token (Fase 2)

- **R7.1** WHEN o admin gera/rotaciona o token, THE app web SHALL escrever
  (atomicamente) o authfile = `{ "voxen:<token>": ["^R:127\\.0\\.0\\.1:1080(:socks)?$"] }`.
  O chisel server faz **hot-reload automático** ao detectar a mudança no arquivo
  (sem sinal — SIGHUP no chisel server NÃO recarrega e mata o processo).
  O sufixo `:socks` é OPCIONAL no match porque o chisel valida o remote SEM o
  sufixo de tipo (`R:127.0.0.1:1080`); regex com `:socks$` obrigatório resulta
  em "access denied" (validado empiricamente em E2E).
- **R7.2** WHEN o admin revoga o token, THE app web SHALL escrever authfile `{}`
  (nega qualquer conexão); o chisel recarrega sozinho.
- **R7.3** THE app web SHALL sincronizar o authfile uma vez no boot (após DB
  pronto), refletindo o estado persistido do token.
- **R7.4** THE authfile SHALL restringir o remote ao ÚNICO valor esperado
  (`R:127.0.0.1:1080`, com `:socks` opcional, bind localhost) via regex ancorada
  — nunca `R:.*`.
- **R7.5** THE app web SHALL escrever o authfile com permissão 600 e NUNCA logar
  o token. A operação é **best-effort**: sem chisel/pidfile/`/run/voxen` (dev),
  loga e segue sem quebrar boot nem endpoints admin.

### R8 — Roteamento do worker (Fase 2)

- **R8.1** WHEN o token é gerado e não há proxy configurado, THE app web SHALL
  setar `yt_dlp_proxy_urls = socks5h://127.0.0.1:1080` (worker é socks5-capable,
  spec 058).
- **R8.2** WHEN o admin gera o token mas já existe um proxy customizado em
  `yt_dlp_proxy_urls`, THE app web SHALL preservá-lo (não sobrescreve).
- **R8.3** WHEN o admin revoga o token, THE app web SHALL limpar
  `yt_dlp_proxy_urls` SOMENTE se for exatamente `socks5h://127.0.0.1:1080`
  (não apaga um proxy http custom do operador).

## Mecanismo de exposição (Fase 2.1) — proxy WebSocket na URL do Voxen

**Decisão.** O túnel NÃO usa mais um subdomínio `tunnel.<host>` separado. A
própria web do Voxen faz **proxy de WebSocket** num path dedicado e encaminha pro
chisel server local. O agente residencial recebe a URL de controle como
`https://<url-do-voxen>/_tunnel` — o chisel client faz o upgrade pra WebSocket
sozinho. A web faz pipe bidirecional com `ws://127.0.0.1:${CHISEL_PORT:-8088}`.

> **Esquema HTTPS, não WSS (validado em E2E).** A URL passada ao chisel client
> DEVE ser `http://`/`https://`, não `ws://`/`wss://`: o chisel client interpreta
> o esquema e faz o upgrade WebSocket por conta própria. Passar `wss://` quebra
> com `dial tcp: address wss::80: too many colons`. Por isso `deriveTunnelUrl()`
> e `originToTunnelUrl()` preservam o esquema http(s) e NÃO convertem pra ws/wss;
> `PROXY_TUNNEL_URL`/entrypoint normalizam `wss://`→`https://` e `ws://`→`http://`
> defensivamente (mantendo TLS obrigatório: `http://` puro continua rejeitado).

**Por que funciona com o chisel (confirmado no source `jpillora/chisel`).**

- O chisel server NÃO roteia o upgrade de WebSocket por **path** — o que dispara
  o túnel é o header `Sec-WebSocket-Protocol: chisel-v3` (+ `Upgrade: websocket`).
  O path é cosmético: `/_tunnel` na web → `/` no chisel funciona transparente.
- O transporte é WebSocket **binário puro** (SSH por cima). Um pipe frame-a-frame
  não quebra nada — não há framing custom.
- O subprotocolo `chisel-v3` é **obrigatório**: o proxy abre o socket upstream
  pedindo esse subprotocolo e ecoa de volta pro agente, senão o chisel server
  ignora a conexão.

**Componentes (Fase 2.1).**

- `apps/web/src/lib/tunnel-proxy.ts` — `tryUpgradeTunnel(req, server)` intercepta
  só o path do túnel e faz `server.upgrade()`; `tunnelWebSocketHandler` faz o pipe
  agente ⇄ chisel. Plugado no `export default` do `apps/web/src/index.ts` (antes
  do Hono; só intercepta o path EXATO do túnel, não toca outros upgrades).
- `apps/web/src/lib/proxy-agent-tunnel.ts` — `proxyTunnelPath()` (env
  `PROXY_TUNNEL_PATH`, default `/_tunnel`) e `deriveTunnelUrl()` (auto-coletada,
  ver abaixo).

### R9 — Proxy WebSocket (Fase 2.1)

- **R9.1** THE web SHALL aceitar upgrade de WebSocket no path `PROXY_TUNNEL_PATH`
  (default `/_tunnel`) e fazer pipe bidirecional com `ws://127.0.0.1:CHISEL_PORT`.
- **R9.2** THE proxy SHALL negociar o subprotocolo `chisel-v3` no upstream e ecoá-lo
  de volta pro agente; SHALL repassar frames binários sem transformação.
- **R9.3** THE proxy SHALL interceptar SOMENTE o path EXATO do túnel — qualquer
  outra rota (incl. outros upgrades-ws) segue pro Hono normal.
- **R9.4** WHEN um GET não-upgrade bate no path do túnel, THE proxy SHALL responder
  `426 Upgrade Required` sem tocar no chisel.
- **R9.5** THE proxy SHALL fazer cleanup dos dois lados em close/erro de qualquer
  ponta; SHALL NUNCA logar tráfego (são bytes SSH + token de auth).

## Derivação da URL do túnel (auto-coletada)

A URL de conexão é derivada no backend (`deriveTunnelUrl`) nesta ordem:

1. SE a env `PROXY_TUNNEL_URL` está setada, usa ela diretamente (operador assume
   o controle total — outro host/porta/path); se vier `ws://`/`wss://`, normaliza
   pra `http://`/`https://` (o chisel client quer http(s)).
2. SENÃO, deriva de `APP_BASE_URL` (a URL pública do **próprio Voxen**):
   **preserva o esquema http(s)** (NÃO converte pra ws/wss — o chisel client faz
   o upgrade sozinho), preserva hostname e porta, e anexa `proxyTunnelPath()`
   (ex.: `https://voxen.exemplo.com` → `https://voxen.exemplo.com/_tunnel`).
3. SE nenhuma resolve, retorna `null` (UI orienta a configurar `APP_BASE_URL`).

Sem subdomínio manual: a URL sai da URL pública do Voxen. Na UI, quando o backend
não tem `APP_BASE_URL`, o snippet usa `window.location.origin` (esquema http(s)
preservado + path) como fallback de **exibição** — auto-coletando da URL que o admin
já está acessando.

### R10 — Status REAL ao vivo (Fase 2.2)

Substitui o placeholder `agentStatus` de R2.2 por sinais reais.

- **R10.1** WHEN um admin consulta `GET /api/admin/proxy-agent`, THE backend SHALL
  fazer um **TCP connect best-effort** a `127.0.0.1:${CHISEL_SOCKS_PORT:-1080}`
  (o SOCKS reverso que o chisel só abre quando um agente conecta) com timeout
  curto (~1s) e retornar `connected: boolean` (conecta = agente ativo; recusa /
  timeout / erro = sem agente). A probe NUNCA lança e NUNCA pendura o request.
- **R10.2** WHILE não há chisel / em dev (porta fechada), THE backend SHALL
  retornar `connected: false` sem erro (best-effort).
- **R10.3** THE UI admin SHALL exibir um indicador AO VIVO (polling ~9s, com
  cleanup do interval no unmount): verde "Conectado e funcionando" quando
  `connected`, cinza "Desconectado" caso contrário. A seção é SEMPRE exibida.
- **R10.4** THE endpoint NÃO expõe o SOCKS à rede nem retorna o token; a probe é
  só um connect/disconnect local (sem handshake SOCKS).

### R11 — Detecção de conflito (single-connection)

A garantia de conexão única vem do port-bind: o 2º agente não consegue bindar
`127.0.0.1:1080` e o chisel server loga `address already in use`. Esta seção
faz SURFACE desse sinal na UI.

- **R11.1** THE entrypoint SHALL redirecionar a saída do chisel server para um
  arquivo de log (`CHISEL_LOGFILE`, default `/run/voxen/chisel.log`) ALÉM do
  stdout, capturando o PID do **chisel** (não do `tee`) via process substitution.
- **R11.2** IF o log-capture falhar (sem `/run/voxen`, `tee` indisponível), THE
  entrypoint SHALL subir o chisel SEM log-capture — NUNCA quebrar o boot.
- **R11.3** WHEN o admin consulta o status, THE backend SHALL ler as últimas
  linhas do log e retornar `conflict: true` se houver `address already in use`
  (case-insensitive) recente; sem log (dev) → `conflict: false`, sem erro.
- **R11.4** WHEN `conflict`, THE UI SHALL exibir um aviso âmbar "Múltiplos
  agentes detectados — rode apenas um" (i18n pt/en).

### R12 — Remoção da config de proxy manual

- **R12.1** THE tela de Configurações (`setup`) SHALL **remover** o input manual
  de `yt_dlp_proxy_urls` (campo, estado, handler, envio no payload e i18n órfão).
- **R12.2** THE setting `yt_dlp_proxy_urls` SHALL permanecer no backend, gerenciado
  EXCLUSIVAMENTE pelo agente (seta `socks5h://127.0.0.1:1080` ao gerar token,
  limpa ao revogar) — apenas a UI manual sai.
- **R12.3** THE seção do Agente de Proxy SHALL exibir uma nota de que o proxy de
  extração é gerenciado automaticamente pelo agente.

## Endpoints

- `GET /api/admin/proxy-agent` — status (`configured`, `tunnelUrl`, `connected`,
  `conflict`). `connected` = probe TCP ao SOCKS local; `conflict` = parse do log.
- `POST /api/admin/proxy-agent/token` — gera/rotaciona; retorna `{ token, tunnelUrl }`.
- `DELETE /api/admin/proxy-agent/token` — revoga.

## Fora do escopo (PRs futuras)

- ~~Servidor chisel embutido no `web`/entrypoint.~~ (Fase 2 — esta entrega)
- ~~Integração do worker com o proxy do túnel (roteamento de yt-dlp).~~ (Fase 2)
- ~~Exposição da porta de controle via subdomínio/TLS no deploy.~~ (Fase 2.1 —
  agora o agente conecta na própria URL do Voxen via proxy ws em `/_tunnel`.)
- ~~Status real da conexão do agente (substitui o placeholder de R2.2).~~ (Fase 2.2
  — esta entrega: probe TCP ao SOCKS local + detecção de conflito.)
- Host-key pinning automático (fingerprint) entregue na UI.

## Critérios de aceite

### Fase 1 (spec 058 — já entregue)

- [x] Geração persiste o token **cifrado** (não em texto puro) no DB.
- [x] `GET` nunca retorna o token (nem preview do valor cifrado).
- [x] Não-admin recebe 403; não-autenticado recebe 401.
- [x] Token tem entropia >= 32 bytes.
- [x] UI mostra token uma vez + snippet de instalação + revogar.
- [x] i18n nos dois locales.

### Fase 2 (esta entrega)

- [x] Imagem `voxen-app` contém o binário do chisel verificado por SHA256.
- [x] Entrypoint sobe o chisel server (`--reverse`, `CHISEL_PORT`) best-effort,
      sem derrubar o boot dos serviços core.
- [x] `buildChiselAuthfile(token)` monta `{ "voxen:<token>": [regex] }` (com
      token) ou `{}` (sem token); regex ancorada ao remote localhost.
- [x] `syncChiselAuthfile()` é best-effort: sem pidfile/arquivo não quebra.
- [x] POST/DELETE do token e o boot do web chamam `syncChiselAuthfile()`.
- [x] Token gerado aponta o worker pro SOCKS local; revogar limpa só o socks local.
- [x] Remote do agente é `R:127.0.0.1:1080:socks` (bind localhost), batendo com
      a regex do authfile (`:socks` opcional no match — o chisel valida o remote
      sem o sufixo de tipo).

### Fase 2.1 (esta entrega — proxy ws na URL do Voxen)

- [x] `deriveTunnelUrl()` deriva da `APP_BASE_URL` (esquema http(s) preservado,
      + path — o chisel client faz o upgrade ws sozinho); `PROXY_TUNNEL_URL` tem
      precedência (ws/wss normalizado pra http/https); sem env → `null`.
- [x] Sem mais subdomínio `tunnel.<host>` (comportamento legado removido).
- [x] Proxy ws no `apps/web` (`tunnel-proxy.ts`) plugado no `index.ts`, pipe pro
      `ws://127.0.0.1:CHISEL_PORT`, subprotocolo `chisel-v3` negociado.
- [x] Path configurável por `PROXY_TUNNEL_PATH` (default `/_tunnel`).
- [x] UI auto-coleta a URL (backend ou `window.location.origin`) + remote SOCKS.
- [x] Testes de `deriveTunnelUrl` (esquema http(s) preservado, porta, path,
      precedência, normalização de ws/wss explícito).

### Fase 2.2 (esta entrega — status ao vivo + conflito + remoção do proxy manual)

- [x] `GET /api/admin/proxy-agent` retorna `connected` (probe TCP best-effort ao
      `127.0.0.1:${CHISEL_SOCKS_PORT:-1080}`, timeout ~1s) e `conflict` (parse do
      log do chisel). Ambos best-effort: dev sem chisel → false sem erro.
- [x] `probeAgentConnected()` nunca lança e nunca pendura (socket destruído em
      qualquer desfecho); testes com porta aberta/fechada/inválida.
- [x] `detectConflictInLog()` pura e testável; pega "address already in use"
      (case-insensitive) só na cauda; ignora conflito antigo fora da janela.
- [x] UI: indicador ao vivo (polling ~9s + cleanup) verde/cinza, SEMPRE visível;
      banner âmbar de conflito; nota "proxy gerenciado pelo agente"; i18n pt/en.
- [x] Entrypoint redireciona o chisel pra `CHISEL_LOGFILE` via process
      substitution (PID do chisel preservado); fallback sem log-capture se falhar
      — boot nunca quebra (`bash -n` ok).
- [x] Config de proxy manual (`yt_dlp_proxy_urls`) REMOVIDA da tela de
      Configurações (campo, estado, payload, status `ytDlp.proxies`, i18n órfão);
      o setting permanece no backend, gerenciado só pelo agente.

### Fase 3 (deploy real — fora desta PR)

- [x] Túnel ponta-a-ponta no deploy: agente conecta em `https://<url>/_tunnel`
      (o chisel client faz o upgrade ws sozinho), worker baixa via SOCKS local.
      **Validado em E2E real** — dois bugs encontrados e corrigidos: (1) a URL
      precisa ser `https://` e não `wss://` (chisel client quebrava com
      `dial tcp: address wss::80: too many colons`); (2) a regex do authfile
      precisa aceitar `:socks` opcional (chisel valida o remote sem o sufixo de
      tipo, `R:127.0.0.1:1080`, senão "access denied"). Com os fixes, o chisel
      conecta e abre `proxy#R:127.0.0.1:1080=>socks: Listening`.
- [ ] (Opcional) Host-key pinning automático (fingerprint) entregue na UI.
