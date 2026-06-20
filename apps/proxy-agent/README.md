# voxen-proxy-agent

Agente de proxy residencial do Voxen. É um **cliente [chisel](https://github.com/jpillora/chisel)**
(MIT) empacotado numa imagem Docker mínima. Você instala no seu home lab
(qualquer Linux com Docker / Easypanel, num IP residencial) e ele disca pra VPS
do Voxen abrindo um **túnel reverso com SOCKS5**.

## Por que isso existe

O Voxen roda numa VPS, que tem IP de datacenter. YouTube/Instagram/TikTok
bloqueiam downloads vindos de datacenter ("Sign in to confirm you're not a
bot"). Roteando o egress de download por um **IP residencial**, esses bloqueios
somem.

Como o home lab fica atrás de NAT/CGNAT, quem disca é o agente (túnel reverso):
o agente conecta na VPS via TLS e a VPS passa a oferecer, **só em
`127.0.0.1:1080`**, um SOCKS5 cujo egress sai pela sua internet de casa. O
worker do Voxen usa `socks5h://127.0.0.1:1080` como proxy. A aplicação inteira
continua na VPS — só o tráfego de download é que sai por casa.

```
[ Worker (VPS) ] --socks5h://127.0.0.1:1080--> [ chisel server (voxen-app, VPS) ]
                                                          ^  túnel TLS (wss)
                                                          |
                                          [ voxen-proxy-agent (seu home lab) ]
                                                          |
                                                          v
                                                   internet residencial --> YouTube/IG/TikTok
```

## Requisitos

- Docker (ou Easypanel) num host Linux com **IP residencial**.
- Saída de internet liberada na **porta 443 (HTTPS/WSS)** — é só uma conexão de
  saída; **nenhuma porta de entrada** precisa ser aberta no seu roteador.
- A URL do túnel e o token, fornecidos pela **UI admin do Voxen**.

## Instalação

### Opção A — Docker Compose (recomendado)

1. Copie os arquivos `docker-compose.yml` e `.env.example` deste diretório pro
   seu home lab (ou pegue o snippet pronto na UI admin do Voxen).
2. Crie o `.env`:

   ```bash
   cp .env.example .env
   # edite .env e cole VOXEN_TUNNEL_URL e VOXEN_TUNNEL_TOKEN
   ```

3. Suba:

   ```bash
   docker compose up -d
   docker compose logs -f
   ```

### Opção B — docker run

```bash
docker run -d --name voxen-proxy-agent --restart unless-stopped \
  -e VOXEN_TUNNEL_URL="https://tunnel.exemplo.com" \
  -e VOXEN_TUNNEL_TOKEN="cole-o-token-aqui" \
  ghcr.io/yefclub/voxen-proxy-agent:latest
```

> O agente não expõe nenhuma porta no host. Não use `-p`.

## Variáveis de ambiente

| Variável                   | Obrigatória | Default          | Descrição                                                              |
| -------------------------- | ----------- | ---------------- | --------------------------------------------------------------------- |
| `VOXEN_TUNNEL_URL`         | Sim         | —                | URL de controle do túnel (deve ser `https://` / TLS).                 |
| `VOXEN_TUNNEL_TOKEN`       | Sim         | —                | Token de auth do túnel, gerado na UI admin (mostrado uma única vez).  |
| `VOXEN_TUNNEL_FINGERPRINT` | Não         | —                | Fingerprint do server pra host-key pinning (fortemente recomendado).  |
| `VOXEN_SOCKS_REMOTE`       | Não         | `R:127.0.0.1:1080:socks` | Remote reverso (bind em localhost na VPS). Deve casar com a regex do authfile do server. |
| `VOXEN_KEEPALIVE`          | Não         | `25s`            | Intervalo de keepalive.                                               |
| `VOXEN_MAX_RETRY_INTERVAL` | Não         | `30s`            | Espera máxima entre tentativas de reconexão.                          |
| `VOXEN_AUTH_USER`          | Não         | `voxen`          | Usuário de auth (par `user:token`).                                   |

Se faltar `VOXEN_TUNNEL_URL` ou `VOXEN_TUNNEL_TOKEN`, o agente **recusa iniciar**
com erro claro. Reconexão é automática e infinita (`--max-retry-count -1`).

## Segurança

- **TLS fim-a-fim.** A conexão sai do agente como `wss://` e é terminada pelo
  traefik na VPS. Use sempre `https://` na `VOXEN_TUNNEL_URL` — o agente recusa
  esquemas sem TLS.
- **Token vem da UI do Voxen.** É uma credencial de alta entropia gerada e
  guardada cifrada pela aplicação. Trate como secret: ponha no `.env` (fora do
  versionamento) ou no gestor de secrets do Easypanel.
- **O token nunca aparece em logs.** O entrypoint mascara o token (`token=********`)
  e nunca ecoa o comando completo.
- **Host-key pinning.** Defina `VOXEN_TUNNEL_FINGERPRINT` (fornecido pela UI) pra
  validar a identidade do server e evitar MITM. Sem ele o agente avisa no log.
- **Sem portas de entrada.** O agente só faz conexão de saída; o SOCKS5 vive em
  `127.0.0.1` na VPS, nunca exposto publicamente.

## Imagem

Baseada em `alpine`, usuário não-root, init via `tini`. O binário do chisel é a
versão **v1.11.5**, baixada do release oficial e verificada por checksum SHA256
no build (reprodutível). Build local:

```bash
docker build -t voxen-proxy-agent apps/proxy-agent/
```
