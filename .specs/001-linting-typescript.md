# Spec 001 — Linting e Type-check TypeScript

## Contexto

Na fundação (PR #17) o lint e typecheck TS foram **desativados temporariamente** no CI porque a configuração não funcionava:

1. `apps/web/.eslintrc.cjs` é legacy. **ESLint 9 deprecou** `.eslintrc.*` em favor de **flat config** (`eslint.config.js`).
2. `apps/web/tsconfig.json` declara `types: ["bun-types"]` mas a devDep é `@types/bun`. **Mismatch**: o tipo precisa estar no nome correto pra TypeScript resolver.
3. Faltam plugins de ESLint (`@typescript-eslint/*`, `eslint-plugin-react`, `eslint-config-prettier`) que o `.eslintrc.cjs` referencia.

Resultado: `lint-ts` e `typecheck-ts` foram removidos do `.github/workflows/ci.yml` (TODO inline) e `test-ts` ficou com `continue-on-error: true`.

Esta spec define como destravar.

## Requisitos

### Ubiquitous

- The system shall validate TypeScript types in `apps/web/src/**/*.{ts,tsx}` via `tsc --noEmit` with `strict: true`.
- The system shall lint TypeScript files in `apps/web/{src,tests}/**/*.{ts,tsx}` via ESLint 9 flat config (`eslint.config.js`).
- The system shall lint with `--max-warnings 0` — any warning fails the build.

### Event-driven

- **When** a PR is opened or pushed to `dev`/`main`, the system shall run `lint-ts` and `typecheck-ts` jobs in CI and **fail the build on errors** (no `continue-on-error`).
- **When** `bun test` runs in `apps/web`, the system shall execute without `continue-on-error` — failures block CI.

### State-driven

- **While** the project is at v0.x with no React UI committed yet, the ESLint config shall NOT require `eslint-plugin-react` (avoids unused dep + transient deps with vulns).
- **While** the project has a React UI committed, the ESLint config shall include `eslint-plugin-react` and `eslint-plugin-react-hooks`.

### Unwanted behavior

- **If** a TypeScript file contains an unused import, the lint shall fail.
- **If** a TypeScript file uses `any` without explicit `eslint-disable-next-line` justification, the lint shall fail.
- **If** the Bun runtime types (`Bun`, `fetch`, etc.) aren't recognized, the typecheck shall fail.

## Critérios de Aceite

- [ ] `.eslintrc.cjs` removido de `apps/web/`
- [ ] `apps/web/eslint.config.js` criado em flat config (ESM)
- [ ] `apps/web/tsconfig.json` aponta types corretamente — `["bun"]` se devDep é `@types/bun`, `["bun-types"]` se devDep é `bun-types`. Escolha documentada
- [ ] Plugins adicionados como devDeps em `apps/web/package.json` (typescript-eslint v8 unificado + globals)
- [ ] `lockfile` regerado e commitado
- [ ] `make typecheck` passa local
- [ ] `make lint` passa local
- [ ] CI: jobs `lint-ts` e `typecheck-ts` reativados em `.github/workflows/ci.yml`
- [ ] CI: `test-ts` sem `continue-on-error: true`
- [ ] Reviewer #4 follow-up: criar issue rastreando esta spec — **resolvido por esta PR fechar a spec**

## Fora de Escopo

- Configurar ESLint em apps/chat ou apps/worker (esses usam Ruff/mypy — outro fluxo)
- Adicionar plugins de acessibilidade (`jsx-a11y`) — entra quando UI for implementada (Fase 5+)
- Configurar Prettier (já existe `.prettierrc.json` minimal, basta)

## Riscos / Decisões pendentes

- **typescript-eslint v8 unificado** ou par `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` legacy? **Decisão**: usar `typescript-eslint` (v8+) unificado — é a forma recomendada em flat config.
- **`bun-types` vs `@types/bun`**: ambos funcionam. **Decisão**: `@types/bun` (já está no package.json, é o recomendado pelo Bun em docs 2026). tsconfig types vai como `["bun"]`.
- **`eslint-plugin-react` agora ou depois**: como `apps/web/src/` ainda não tem React (só `index.ts` Hono), **adicionar depois**. Spec state-driven cobre.

## Histórico

> 2026-05-15: spec criada como resposta ao TODO do CI em PR #17 (chore: scaffolding inicial).
