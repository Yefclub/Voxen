# 062 — Publicar imagem do proxy-agent no GHCR

## Contexto

O `apps/proxy-agent/` é o cliente chisel que disca pra VPS e expõe um SOCKS5
reverso pelo IP residencial. Hoje a imagem dele NÃO é publicada em nenhum
registry — o `docker-compose.yml` do agente usa `build: .` local. Isso obriga
o owner a clonar o repo e buildar na mão pra rodar o agente em qualquer host
residencial.

O owner quer rodar `docker run ghcr.io/yefclub/voxen-proxy-agent:latest`
direto, sem build local. Para isso a imagem precisa ser publicada no GHCR a
cada mudança do agente (push em `dev`/`main`) e em tags de release.

O workflow `.github/workflows/easypanel-image.yml` já é o padrão de publicação
no GHCR (login com `GITHUB_TOKEN`, `packages: write`, buildx, build-push-action).
Este workflow replica esse padrão para o proxy-agent, com paths filter para só
rodar quando o agente muda.

## Glossário

- **GHCR**: GitHub Container Registry (`ghcr.io`).
- **chisel**: túnel TCP/UDP sobre HTTP (MIT) usado pelo agente.
- **proxy-agent**: serviço em `apps/proxy-agent/` (Dockerfile multi-arch
  amd64/arm64 via `TARGETARCH`).

## Requisitos (EARS)

- **REQ-1** — Quando houver `push` na branch `dev` que toque
  `apps/proxy-agent/**` ou o próprio workflow, o sistema DEVE buildar e
  publicar a imagem `ghcr.io/yefclub/voxen-proxy-agent` com as tags `:latest`
  e `:sha-<short>`.

- **REQ-2** — Quando houver `push` na branch `main` que toque
  `apps/proxy-agent/**` ou o próprio workflow, o sistema DEVE buildar e
  publicar a imagem com as tags `:latest` e `:sha-<short>`.

- **REQ-3** — Quando houver `push` de uma tag no padrão
  `v[0-9]+.[0-9]+.[0-9]+`, o sistema DEVE publicar a imagem com as tags
  `:sha-<short>`, `:<version>` (sem o `v`) e `:<vX.Y.Z>` (com o `v`).

- **REQ-4** — A imagem DEVE ser publicada para as plataformas
  `linux/amd64` e `linux/arm64` (multi-arch), coerente com o Dockerfile do
  agente que resolve o binário do chisel via `TARGETARCH`.

- **REQ-5** — O build DEVE usar `context: apps/proxy-agent` e
  `file: apps/proxy-agent/Dockerfile`, pois o Dockerfile copia
  `entrypoint.sh` relativo ao diretório do agente (não à raiz do repo).

- **REQ-6** — O workflow DEVE poder ser disparado manualmente via
  `workflow_dispatch`.

- **REQ-7** — O workflow DEVE autenticar no GHCR usando
  `secrets.GITHUB_TOKEN` com `permissions: packages: write`, sem secrets
  adicionais.

- **REQ-8** — Este workflow NÃO DEVE alterar os workflows existentes
  (`easypanel-image.yml`, `ci.yml`, `security.yml`, `release.yml`). É adição
  cirúrgica de um arquivo novo.

## Fora de escopo

- Atualizar o `docker-compose.yml` do agente para usar a imagem publicada
  (`image:` em vez de `build:`) — pode ser feito num PR posterior.
- Documentação de uso (`docker run ...`) no README do agente.

## Critérios de aceite

1. Existe `.github/workflows/proxy-agent-image.yml` com YAML válido.
2. O paths filter cobre `apps/proxy-agent/**` e o próprio workflow.
3. As tags computadas batem com REQ-1..REQ-3.
4. `platforms: linux/amd64,linux/arm64` no `build-push-action`.
5. `context`/`file` apontam para `apps/proxy-agent`.
6. Nenhum workflow existente foi modificado.
