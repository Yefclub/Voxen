# 036 — Player de mídia e visualizador de imagem para uploads

## Contexto

A spec 033 passou a persistir a mídia original de uploads no S3 e expôs
`GET /api/transcripts/:id/original` (autenticado, `inline`). Mas a página de
detalhe só mostrava uma thumbnail estática + botão "abrir arquivo enviado" — não
dava pra assistir/ouvir/ampliar o conteúdo dentro do app. Além disso, o endpoint
servia o objeto inteiro com status 200, **sem suporte a HTTP Range**, o que quebra
o seek de vídeo e faz o Safari/iOS recusar a tag `<video>`.

## Escopo

- Adicionar suporte a HTTP Range (206) ao endpoint de mídia original.
- Player de vídeo inline (com poster), player de áudio inline e visualizador de
  imagem com lightbox no detalhe da transcrição, para fontes de upload.
- Manter o botão de baixar/abrir o arquivo original.

## Requisitos

### R1 — Streaming com Range

- WHEN o cliente envia header `Range` em `/api/transcripts/:id/original` THEN o
  servidor SHALL repassar o range ao S3 e responder `206` com `Content-Range` e
  `Content-Length` corretos.
- WHEN não há header `Range` THEN o servidor SHALL responder `200` com
  `Accept-Ranges: bytes` e `Content-Length`.
- WHEN o range é insatisfatível THEN o servidor SHALL responder `416`.
- WHEN qualquer resposta é servida THEN o `Content-Type` SHALL priorizar o MIME
  persistido da transcrição.

### R2 — Player/visualizador no detalhe

- WHEN a transcrição tem `originalObjectKey` + `originalMimeType` de vídeo THEN o
  detalhe SHALL renderizar um `<video controls>` apontando para o endpoint
  autenticado, com a preview como poster.
- WHEN o MIME é de áudio THEN o detalhe SHALL renderizar um `<audio controls>`.
- WHEN o MIME é de imagem THEN o detalhe SHALL mostrar a imagem e permitir
  ampliá-la em lightbox (Dialog).
- WHEN a fonte não tem mídia original (YouTube/WEB/etc.) THEN o detalhe SHALL
  manter a thumbnail estática atual.

### R3 — Segurança

- WHEN a mídia é servida THEN o acesso SHALL continuar exigindo sessão autenticada
  e validar ownership de `transcriptId` (sem URL pública permanente).
- WHEN o MIME do upload é mídia segura (`video/*`, `audio/*`, `image/png|jpeg|webp|gif`)
  THEN a resposta SHALL usar `Content-Disposition: inline`; para qualquer outro tipo
  (ex.: `text/html`, `image/svg+xml`, `application/pdf`) SHALL usar `attachment`
  (download), evitando execução same-origin de upload malicioso (XSS armazenado).
- WHEN qualquer mídia original é servida THEN a resposta SHALL incluir
  `X-Content-Type-Options: nosniff`.

## Fora de escopo

- Geração de legendas/captions para a mídia enviada.
- Transcodificação para HLS/streaming adaptativo (servimos o arquivo original).
- Player na listagem (`/transcricoes`) — apenas no detalhe.

## Critérios de aceite

- [ ] `buildOriginalResponseInit` decide 200 vs 206 e headers; coberto por teste.
- [ ] Vídeo faz seek (206) no detalhe; imagem amplia em lightbox; áudio toca.
- [ ] typecheck, lint, prettier, `bun test` e build do client verdes.
