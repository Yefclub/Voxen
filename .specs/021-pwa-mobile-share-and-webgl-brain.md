# 021 — PWA mobile share + Brain WebGL

## Contexto

O Voxen precisa funcionar bem como app instalado em Android/home-lab sem manter
um app React Native separado nesta fase. O primeiro alvo é PWA installable com
compartilhamento nativo de links e arquivos, mantendo login no servidor
self-hosted existente.

A página `/grafo` também precisa deixar de depender só de uma superfície estática:
o Brain deve ser uma visualização interativa, pan/zoom/foco, adequada ao harness
de conhecimento usado pela Vox e por MCP.

Pesquisa usada:

- MDN Web App Manifest `share_target`.
- web.dev Web Share Target.
- vite-plugin-pwa.
- Sigma.js renderer WebGL.
- Graphology graph model.

## Decisões

- Usar `vite-plugin-pwa` com service worker `generateSW`, atualização automática e
  manifest installable.
- Registrar `share_target` em `/share-target` com `POST multipart/form-data`.
- Para links compartilhados:
  - com sessão aprovada: criar job via mesmo fluxo de `/api/jobs/auto`;
  - sem sessão: preservar o link em `/jobs?shared=1&url=...` para enfileirar
    após login.
- Para arquivos compartilhados:
  - com sessão aprovada: criar job via mesmo fluxo de `/api/jobs/upload`;
  - sem sessão: avisar que o arquivo precisa ser compartilhado após login, pois
    o navegador não reenvia o `File` depois da autenticação.
- Usar Graphology como modelo interno do Brain e Sigma.js como renderer WebGL.
- Manter fallback SVG determinístico quando WebGL/canvas não estiver disponível.
- Não implementar descoberta automática LAN/mDNS neste ciclo.
- Alterar versão dev para `X.Y.Z-dev.<unix_epoch_seconds>` nos workflows.

## Critérios de aceite

- [x] Build Vite gera manifest + service worker e usa os ícones existentes.
- [x] Manifest expõe atalhos de Chat, Transcrever e Brain.
- [x] Manifest registra share target para texto, URL e arquivos suportados.
- [x] `/share-target` cria jobs para links e arquivos quando o user está logado.
- [x] `/jobs` preserva compartilhamento de link após login e mostra feedback.
- [x] `/entrar` volta para a rota original com query string após login.
- [x] `/grafo` usa Sigma.js/Graphology em WebGL com seleção, hover, pan e zoom.
- [x] `/grafo` mantém fallback SVG se Sigma/WebGL falhar.
- [x] Testes cobrem helpers do grafo WebGL.
- [x] Workflows dev usam versão `X.Y.Z-dev.<unix_epoch_seconds>`.
