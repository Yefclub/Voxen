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
  (atomicamente) o authfile = `{ "voxen:<token>": ["^R:127\\.0\\.0\\.1:1080:socks$"] }`.
  O chisel server faz **hot-reload automático** ao detectar a mudança no arquivo
  (sem sinal — SIGHUP no chisel server NÃO recarrega e mata o processo).
- **R7.2** WHEN o admin revoga o token, THE app web SHALL escrever authfile `{}`
  (nega qualquer conexão); o chisel recarrega sozinho.
- **R7.3** THE app web SHALL sincronizar o authfile uma vez no boot (após DB
  pronto), refletindo o estado persistido do token.
- **R7.4** THE authfile SHALL restringir o remote ao ÚNICO valor esperado
  (`R:127.0.0.1:1080:socks`, bind localhost) via regex ancorada — nunca `R:.*`.
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

## Derivação da URL do túnel

A URL de conexão do túnel é derivada no backend nesta ordem:

1. SE a env `PROXY_TUNNEL_URL` está setada, usa ela diretamente.
2. SENÃO, deriva de `APP_BASE_URL` prefixando o hostname com `tunnel.`
   (ex.: `https://voxen.exemplo.com` → `https://tunnel.voxen.exemplo.com`).
3. SE nenhuma das duas resolve, retorna `null` (UI mostra aviso de configurar
   `PROXY_TUNNEL_URL`/`APP_BASE_URL`).

A porta/scheme seguem o `APP_BASE_URL`. A escolha de `tunnel.<host>` é uma
convenção; o operador pode sobrescrever com `PROXY_TUNNEL_URL` quando o túnel
roda em outro host/porta.

## Endpoints

- `GET /api/admin/proxy-agent` — status (`configured`, `tunnelUrl`, `agentStatus`).
- `POST /api/admin/proxy-agent/token` — gera/rotaciona; retorna `{ token, tunnelUrl }`.
- `DELETE /api/admin/proxy-agent/token` — revoga.

## Fora do escopo (PRs futuras)

- ~~Servidor chisel embutido no `web`/entrypoint.~~ (Fase 2 — esta entrega)
- ~~Integração do worker com o proxy do túnel (roteamento de yt-dlp).~~ (Fase 2)
- Publicação da porta de controle via domínio TLS no deploy (Easypanel) — Fase 3.
- Status real da conexão do agente (substitui o placeholder de R2.2).
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
      a regex do authfile.

### Fase 3 (deploy real — fora desta PR)

- [ ] Porta de controle (`CHISEL_PORT`) exposta via domínio TLS no Easypanel.
- [ ] Túnel ponta-a-ponta: agente residencial conecta, worker baixa via SOCKS.
