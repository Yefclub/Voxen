# 058 — Agente de Proxy (túnel residencial) — token de conexão

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

**Escopo desta entrega (PR 1 de N).** Esta entrega cobre **apenas a app web**:
gerenciamento do token (gerar/rotacionar/revogar), persistência cifrada, endpoint
admin de status, e a UI admin com snippet de instalação. O **runtime do chisel**
(servidor de túnel no `web`/entrypoint, cliente no agente, integração com o
worker) vem em PRs separadas e está **fora do escopo aqui**.

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

- Servidor chisel embutido no `web`/entrypoint.
- Cliente chisel no container do agente residencial.
- Integração do worker com o proxy do túnel (roteamento de yt-dlp).
- Status real da conexão do agente (substitui o placeholder de R2.2).

## Critérios de aceite

- [ ] Geração persiste o token **cifrado** (não em texto puro) no DB.
- [ ] `GET` nunca retorna o token (nem preview do valor cifrado).
- [ ] Não-admin recebe 403; não-autenticado recebe 401.
- [ ] Token tem entropia >= 32 bytes.
- [ ] UI mostra token uma vez + snippet de instalação + revogar.
- [ ] i18n nos dois locales.
