# 028 — PWA round 2: cache do service worker, monitor de versão e screenshots

## Contexto

O PWA do Voxen (vite-plugin-pwa, `registerType: 'autoUpdate'`) detecta updates lentamente em produção: o Hono serve `index.html` com `no-store` e `/assets/` com `immutable`, mas todo o resto — incluindo `sw.js`, `registerSW.js` e `manifest.webmanifest` — cai no fallback `public, max-age=3600`. Com o service worker cacheado por 1h, o browser demora até 1h para perceber que existe build novo, mesmo com `skipWaiting`/`clientsClaim` ativos.

Além do fix de cache, o app passa a monitorar a versão do backend (padrão do produto Orbital do owner): `GET /api/version` retorna `version` única por deploy; o frontend compara contra a baseline capturada na montagem e avisa o usuário quando há versão nova. Por fim, o manifest ganha `screenshots` (wide + narrow) para enriquecer o prompt de instalação.

## Requisitos (EARS)

- **REQ-1**: QUANDO o Hono servir `sw.js`, `registerSW.js` ou `manifest.webmanifest`, ENTÃO a resposta DEVE ter `Cache-Control: no-cache, must-revalidate`.
- **REQ-2**: QUANDO o Hono servir `workbox-*.js` na raiz do dist (nome contém hash), ENTÃO a resposta DEVE ter `Cache-Control: public, max-age=31536000, immutable`.
- **REQ-3**: QUANDO o app montar, ENTÃO o frontend DEVE buscar `/api/version` com `cache: 'no-store'` e guardar a `version` como baseline.
- **REQ-4**: ENQUANTO o app estiver aberto, o frontend DEVE reconsultar `/api/version` a cada 60 segundos E nos eventos `focus`, `online` e `visibilitychange` (aba visível), com cleanup correto dos listeners/timer no unmount.
- **REQ-5**: SE a `version` retornada divergir da baseline, ENTÃO o frontend DEVE exibir um toast persistente (sonner, id fixo, `duration: Infinity`) com mensagem i18n (pt-BR/en) e ação "Atualizar" que executa `window.location.reload()`.
- **REQ-6**: SE o fetch de `/api/version` falhar, ENTÃO o monitor DEVE falhar em silêncio (sem toast de erro, sem spam de console) e tentar de novo no próximo ciclo.
- **REQ-7**: O manifest DEVE declarar `screenshots` com uma imagem `form_factor: 'wide'` (1280x800) e uma `form_factor: 'narrow'` (860x1864), servidas de `/screenshots/`.

## Critérios de Aceite

- [ ] `sw.js`, `registerSW.js` e `manifest.webmanifest` respondem com `no-cache, must-revalidate`; `workbox-*.js` responde com `immutable` 1y.
- [ ] Toast de atualização aparece uma única vez (id fixo) quando a versão muda e não aparece em falha de rede.
- [ ] Chaves `shell.updateAvailable` e `shell.updateAction` presentes em pt-BR e en.
- [ ] `dist/manifest.webmanifest` pós-build contém os dois screenshots com dimensões corretas (confirmadas via `magick identify`).
- [ ] Lint, typecheck e build do `@voxen/web` verdes.

## Fora de Escopo

- Mudar a estratégia do service worker (skipWaiting/clientsClaim já vêm do `autoUpdate`).
- Forçar update do SW programaticamente (`registration.update()`) — o reload da página já cobre.
- Polling diferenciado dev/prod (o endpoint é barato; 60s vale para ambos).
