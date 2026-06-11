# 030 — Identidade do build no HTML servido (meta voxen-build)

## Contexto

O monitor de versão (spec 028) captura a baseline buscando `/api/version` na montagem. Isso tem um problema circular no PWA: o service worker serve `index.html` e assets PRECACHEADOS (antigos), mas a baseline vem do servidor (novo) — o app instalado compara "servidor novo vs servidor novo" e nunca detecta que ele próprio está rodando um bundle velho. O bundle/HTML não carrega a própria identidade de build.

A correção: o Hono injeta a identidade do build como `<meta name="voxen-build">` no HTML na hora de servir (sem build args). O monitor passa a comparar a identidade do bundle CARREGADO contra a resposta de `/api/version` — mismatch significa que o bundle em execução é de outro build, cobrindo o caso do PWA precacheado.

## Requisitos (EARS)

- **REQ-1**: QUANDO o Hono servir um arquivo `.html` do dist (incluindo o fallback SPA), ENTÃO a resposta DEVE conter `<meta name="voxen-build" content="...">` logo após `<head>`, onde o content é `VOXEN_GIT_SHA || GIT_SHA || VOXEN_VERSION`, sanitizado para caracteres seguros de atributo HTML.
- **REQ-2**: O HTML transformado DEVE ser cacheado em memória por path (Map) — a leitura/injeção acontece uma única vez por arquivo por processo, não a cada request.
- **REQ-3**: A resposta HTML DEVE manter `Cache-Control: no-store, must-revalidate` e declarar `Content-Type: text/html; charset=utf-8`.
- **REQ-4**: QUANDO o app montar E o meta `voxen-build` existir no documento, ENTÃO o monitor DEVE compará-lo contra `gitSha` (ou `version` se `gitSha` for null) de `/api/version` a cada ciclo de poll; SE divergirem, ENTÃO DEVE exibir o toast de atualização (sonner, id fixo, ação "Atualizar" → reload).
- **REQ-5**: QUANDO o meta `voxen-build` NÃO existir (dev server Vite, builds antigos), ENTÃO o monitor DEVE manter o comportamento da spec 028: baseline = primeira resposta de `/api/version`.
- **REQ-6**: SE o fetch de `/api/version` falhar ou a resposta não tiver identidade comparável, ENTÃO o monitor DEVE falhar em silêncio e tentar no próximo ciclo.

## Critérios de Aceite

- [ ] `GET /` (com dist buildado) responde HTML com `<head><meta name="voxen-build" content="...">` e `no-store`.
- [ ] Fallback SPA (`/qualquer-rota`) recebe o mesmo meta.
- [ ] App servido por bundle precacheado (meta antigo) detecta build novo no primeiro poll após o deploy e mostra o toast.
- [ ] Sem o meta (Vite dev), comportamento idêntico ao anterior (baseline da primeira resposta, sem toast espúrio).
- [ ] Lint, typecheck, testes e build do `@voxen/web` verdes.

## Fora de Escopo

- Build args / injeção de identidade em tempo de build do Vite (a injeção é serve-time de propósito — zero mudança no pipeline de build).
- Mudanças na estratégia do service worker ou no precache do vite-plugin-pwa.
- Alterar o contrato de `/api/version` (já expõe `version`, `gitSha`, `builtAt`).
