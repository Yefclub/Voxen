# 066 — Upload presigned direto pro S3/MinIO

> **2026-08-07 amendment:** Presigned upload remains an S3-only capability.
> Local storage and S3 without `S3_PUBLIC_ENDPOINT` shall use the bounded,
> same-origin streaming transport returned by the upload preparation API.

## Contexto

O upload de mídia atual (`POST /api/jobs/upload`) faz o browser enviar o arquivo
pro app (Hono), que então faz `PutObject` no S3/MinIO. Atrás do Cloudflare, o
corpo da requisição é cortado em ~100 MiB, inviabilizando uploads grandes (limite
de mídia = 500 MiB). Decisão do owner: permitir **upload direto do browser pro
S3/MinIO via presigned URL**, sem o corpo passar pelo app nem pelo Cloudflare.

A feature é **aditiva com fallback**: quando o endpoint público de S3
(`S3_PUBLIC_ENDPOINT`) estiver configurado, o front usa presigned; caso contrário
(ou se o presign falhar), cai no fluxo atual (upload via app). O fluxo existente
NÃO pode quebrar.

## Glossário

- **presign**: gerar uma URL assinada de curta duração que autoriza um `PUT`
  direto no objeto S3 sem expor credenciais.
- **endpoint público** (`S3_PUBLIC_ENDPOINT`): base URL do MinIO/S3 alcançável
  pelo **browser** (ex.: `https://s3.dominio.com`). Diferente do `S3_ENDPOINT`
  interno (`http://minio:9000`), que só a rede Docker enxerga.
- **kind**: classe do upload (`media` | `image` | `document`), cada uma com seu
  limite de tamanho.

## Requisitos (EARS)

### Disponibilidade do presign

- **R1** — When `S3_PUBLIC_ENDPOINT` não estiver definido, the system shall
  responder ao presign com `{ enabled: false }` e o front shall usar o fallback
  (`POST /api/jobs/upload`).
- **R2** — When `S3_PUBLIC_ENDPOINT` estiver definido, the system shall gerar e
  retornar uma presigned PUT URL apontando para esse endpoint.

### Presign (`POST /api/jobs/upload/presign`)

- **R3** — The system shall exigir sessão autenticada e usuário `APPROVED`;
  caller não autenticado/aprovado shall receber 401/403.
- **R4** — The system shall derivar o `userId` **da sessão**, nunca do body.
- **R5** — The system shall aplicar rate-limit por usuário no presign.
- **R6** — When o `filename`+`contentType` não classificam em nenhum kind
  (`detectUploadKind` == null), the system shall responder 400.
- **R7** — When o `size` informado exceder o limite do kind (image 20 MiB,
  document 50 MiB, media 500 MiB), the system shall responder 413.
- **R8** — When o kind for `document` e não houver `default_document_model`
  configurado, the system shall responder 412.
- **R9** — The system shall gerar `uploadId` aleatório (`crypto.randomUUID`) e
  `key = uploadObjectKey(userId, uploadId, filename)`, garantindo que o client
  **nunca** escolha o path do objeto.
- **R10** — The system shall assinar a URL com expiração de 300s e retornar
  `{ enabled: true, uploadId, sourceUrl, key, url, method: 'PUT',
  headers: { 'Content-Type': contentType }, expiresIn: 300 }`.

### Confirm (`POST /api/jobs/upload/confirm`)

- **R11** — The system shall exigir sessão autenticada e usuário `APPROVED`.
- **R12** — The system shall validar a existência do objeto na key esperada via
  **HeadObject** no client interno (`s3Client()`); objeto ausente shall resultar
  em 400.
- **R13** — The system shall validar o `ContentLength` **real** retornado pelo
  HeadObject contra o limite do kind, NÃO confiando no `size` informado pelo
  client; objeto maior que o limite shall resultar em 413 (e o objeto órfão é
  removido).
- **R14** — When a validação passar, the system shall enfileirar o job com o tipo
  derivado do kind (mesma lógica do `POST /api/jobs/upload`) e responder 201 com
  `{ jobId, status, sourceUrl, kind }`.
- **R15** — When o kind for `document` e não houver `default_document_model`,
  the system shall responder 412.

### Segurança

- **R16** — A key do objeto shall ser SEMPRE derivada do `userId` da sessão +
  `uploadId` aleatório, impedindo escrita em workspace alheio.
- **R17** — The system shall NÃO logar a presigned URL completa (contém
  assinatura); logs shall referenciar apenas `key`/`uploadId`.
- **R18** — A expiração da presigned URL shall ser curta (300s).

### Fallback (frontend)

- **R19** — When o presign responder `{ enabled: true }`, the front shall fazer
  `PUT` direto na `url` com barra de progresso (XHR) e depois `POST /confirm`.
- **R20** — When o presign responder `{ enabled: false }` ou falhar, the front
  shall usar o fluxo atual (`POST /api/jobs/upload`).
- **R21** — The front shall exibir mensagens de erro claras (incluindo 413 do
  Cloudflare no fallback) em pt e en.

## Infra (deploy)

- **R22** — Para habilitar presigned em produção, o owner deve setar
  `S3_PUBLIC_ENDPOINT` no serviço web e aplicar CORS no bucket permitindo
  `PUT`/`HEAD` da origin do app com header `Content-Type`. Documentado em
  `docs/DEPLOY.md`.

## Fora de escopo

- Multipart upload (chunked) — presigned PUT simples cobre até 5 GiB por objeto
  no S3; o limite de mídia (500 MiB) está bem abaixo disso.
- Mudanças no worker (lê pela mesma key — inalterado).
