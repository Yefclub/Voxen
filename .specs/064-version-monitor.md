# 064 — Monitor de versão robusto (dismiss persistente + reload garantido)

## Contexto

O cliente web mostra um toast "Nova versão disponível" quando o build servido
diverge do build carregado na aba. A mecânica atual (`apps/web/src/client/lib/use-version-monitor.ts`):

- Lê `<meta name="voxen-build">` (injetado server-side em `apps/web/src/index.ts`
  via `serveHtmlWithBuildMeta`, = identidade do bundle que serviu a página).
- Faz poll de `GET /api/version` (`{ version, gitSha, builtAt }`) a cada 60s +
  nos eventos `focus`/`online`/`visibilitychange`.
- Mostra um toast `sonner` com `duration: Infinity`, id fixo, e ação de reload.

### Problemas observados

1. **Dismiss não persiste.** Se o usuário fecha o toast SEM clicar em
   "Atualizar", o próximo ciclo de poll re-dispara o mesmo toast para o mesmo
   build. Não há registro do build dispensado.
2. **Reload pode não resolver.** Com o PWA (`registerType: 'autoUpdate'`,
   `index.html` precacheado), um `location.reload()` pode servir o `index.html`
   precacheado ANTIGO — o `meta voxen-build` continua velho, o mismatch persiste
   e o toast volta na hora.

## Decisão de escopo

NÃO alterar a estratégia de cache do service worker (precache/NetworkFirst) nem
a config do `vite-plugin-pwa` — risco alto sem ambiente de teste de SW. Em vez
disso, tornar o **cliente à prova de loop**:

- Persistir, em `localStorage`, o `serverBuild` que o usuário **dispensou** ou
  **acionou** (clicou em "Atualizar"). Enquanto o `serverBuild` atual for igual
  ao último registrado, NÃO re-mostrar o toast.
- No "Atualizar", após o caminho normal (SW `reg.update()` + `controllerchange`
  → reload), adicionar um **fallback nuclear** com timeout: limpar `caches` +
  `unregister` do SW + `location.reload()`, garantindo pegar o build fresco.
- Refatorar a lógica de decisão para funções puras testáveis; manter efeitos de
  DOM/SW na borda.

## Requisitos (EARS)

### Detecção

- **R1** — Quando o `meta voxen-build` existe, o sistema DEVE comparar
  `serverBuild = gitSha || version` (do `/api/version`) contra o `meta`. Build
  novo = `serverBuild` definido E diferente do `meta`.
- **R2** — Quando o `meta voxen-build` NÃO existe (dev Vite / builds antigos), o
  sistema DEVE usar como baseline a `version` da primeira resposta de
  `/api/version` e detectar build novo quando `version` mudar.
- **R3** — Enquanto a resposta de `/api/version` falhar (rede/offline), o
  sistema NÃO DEVE mostrar erro; DEVE tentar de novo no próximo ciclo.

### Persistência de dispensa

- **R4** — Quando o usuário dispensa o toast (fecha sem acionar), o sistema DEVE
  persistir o `serverBuild` atual como "tratado" em `localStorage`.
- **R5** — Quando o usuário aciona "Atualizar", o sistema DEVE persistir o
  `serverBuild` atual como "tratado" ANTES de iniciar o reload.
- **R6** — Enquanto o `serverBuild` atual for igual ao último "tratado"
  registrado, o sistema NÃO DEVE re-mostrar o toast.
- **R7** — Quando aparecer um `serverBuild` diferente do último "tratado" (build
  realmente novo), o sistema DEVE mostrar o toast novamente.
- **R8** — Quando o `localStorage` estiver indisponível (modo privado/erro), o
  sistema DEVE degradar para o comportamento em memória da sessão (não quebrar).

### UX de→para

- **R9** — O toast DEVE mostrar a transição de versão de forma clara quando
  ambas as versões (carregada e nova) forem conhecidas:
  "Nova versão disponível (X → Y)". Quando só a nova for conhecida, mostrar
  "Nova versão disponível (Y)". Quando nenhuma, o texto genérico.
- **R10** — O toast DEVE oferecer a ação "Atualizar" e ser dispensável
  (`closeButton`); a dispensa persiste conforme R4/R6.

### Reload garantido

- **R11** — Ao acionar "Atualizar", o sistema DEVE tentar o caminho normal:
  `serviceWorker.getRegistration()` → `addEventListener('controllerchange')` →
  `reg.update()` → reload ao trocar o controller (ou após timeout curto).
- **R12** — Se após ~3,5s o caminho normal não tiver recarregado, o sistema DEVE
  executar o fallback nuclear: `caches.keys()` → `caches.delete(...)` +
  `serviceWorker.getRegistrations()` → `unregister()` + `location.reload()`.
- **R13** — Todo o reload DEVE ser defensivo (try/catch): ausência de
  `serviceWorker`/`caches` cai no `location.reload()` simples sem lançar.

## Funções puras (testáveis)

- `resolveServerBuild(payload)` → `gitSha || version || null`.
- `shouldNotify({ serverBuild, loadedBuild, lastHandledBuild })` → `boolean`
  (true só quando `serverBuild` é novo vs build carregado E diferente do último
  tratado).
- `formatUpdateMessage(t, { loadedVersion, serverVersion })` → string de→para.
- Helpers de `localStorage`: `readHandledBuild()` / `writeHandledBuild(build)`
  defensivos.

## Critérios de aceite (testes `bun test`, sem browser/SW)

1. `resolveServerBuild` prioriza `gitSha`, cai para `version`, senão `null`.
2. `shouldNotify` retorna `false` quando `serverBuild == loadedBuild`.
3. `shouldNotify` retorna `false` quando `serverBuild == lastHandledBuild`
   (dispensado/acionado).
4. `shouldNotify` retorna `true` quando `serverBuild` é novo e nunca tratado.
5. `shouldNotify` retorna `false` para `serverBuild` nulo/vazio.
6. `formatUpdateMessage` produz "X → Y" com ambas versões, "(Y)" só com a nova,
   genérico sem nenhuma.

## Fora de escopo

- Mudanças no service worker / `vite-plugin-pwa`.
- Mudanças no backend além das já existentes (`/api/version` já entrega
  `version` + `gitSha`).
