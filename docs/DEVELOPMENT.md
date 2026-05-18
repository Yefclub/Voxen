# Desenvolvimento — Voxen

Como rodar localmente, testar, fazer TDD/SDD, e contribuir.

## Pré-requisitos

- `docker` + `docker compose` v2
- `git`
- Nada mais. Bun, Python, Postgres, Redis, Garage — tudo em containers.

Opcional (pra rodar tooling fora do container, ex: prisma generate, lint local):
- `bun` 1.2+
- `pnpm` 9+
- `python` 3.13 + `uv`

## Setup inicial

```bash
git clone https://github.com/YefClub-Org/Voxen.git
cd Voxen
make dev
```

Sobe tudo (postgres, redis, garage, web, chat, worker). Master key gerada automaticamente. Garage bootstrap automático.

Acessa `http://localhost:3000`. Primeiro cadastro vira admin → tela de setup pede OpenRouter API key + modelos default.

## Comandos do dia-a-dia (via Makefile)

```bash
make help                  # lista todos os alvos
make dev                   # sobe tudo
make down                  # para tudo (preserva volumes)
make restart               # down + up
make logs                  # tail dos logs (Ctrl+C pra sair)
make ps                    # status

make test                  # roda testes TS + Python
make test-ts               # só TS (apps/web)
make test-py               # só Python (chat + worker)

make lint                  # eslint + prettier + ruff
make typecheck             # tsc + mypy

make migrate               # aplica migrations Prisma (cd no container web)
make seed                  # seed de dev (TBD)

make shell-db              # psql no postgres
make shell-redis           # redis-cli

make garage-init           # reroda bootstrap do garage (idempotente)
make master-key-show       # mostra master key (cuidado — secret)

make clean                 # remove volumes (PERDE DADOS)
```

## SDD — Spec-Driven Development

Antes de implementar QUALQUER feature não-trivial (>2 arquivos, mudança de API, mudança de schema):

1. **Criar spec** em `.specs/NNN-slug.md` usando a skill `spec` (formato EARS)
2. **Co-autorar** com o user — iterar até estar claro
3. **Aprovação explícita** antes de implementar
4. Spec entra no MESMO PR da implementação

EARS = Easy Approach to Requirements Syntax. 5 categorias:
- **Ubiquitous**: `The system shall <X>.`
- **Event-driven**: `When <event>, the system shall <X>.`
- **State-driven**: `While <state>, the system shall <X>.`
- **Optional**: `Where <feature enabled>, the system shall <X>.`
- **Unwanted**: `If <condition>, then the system shall <X>.`

Spec deve ter critérios de aceite testáveis (que viram testes TDD).

## TDD — Test-Driven Development

Pra cada critério de aceite da spec:

1. Escrever teste **falhando**
2. Implementar o mínimo pra fazer passar
3. Refatorar com testes verdes
4. Repetir até todos critérios cobertos

### Tipos de testes

- **Unit**: lógica pura sem IO (vitest pra TS, pytest pra Python)
- **Integration**: testa rotas/services com DB e Redis reais (containers do compose)
- **E2E**: Playwright contra `http://localhost:3000` (flows críticos do user)

### Onde os testes ficam

```
apps/web/tests/         # vitest (unit + integration)
apps/web/e2e/           # playwright
apps/chat/tests/        # pytest
apps/worker/tests/      # pytest
```

### Rodar testes

```bash
make test                       # tudo
cd apps/web && bun test         # só web
cd apps/chat && uv run pytest   # só chat
```

## Git workflow

### Branches

- `main` — branch de release (protegida, só recebe PR de `dev`)
- `dev` — **branch default**, alvo de todas PRs de feature
- `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `refactor/<slug>`, `docs/<slug>` — branches de feature criadas A PARTIR DE `dev`

### Fluxo

1. `git checkout dev && git pull`
2. `git checkout -b feat/<slug>`
3. Criar/atualizar `.specs/NNN-slug.md` se necessário
4. Implementar com TDD
5. `make lint && make typecheck && make test && docker compose build`
6. Commit com conventional message (título em inglês):
   ```
   feat(scope): descrição concisa do que mudou
   
   Corpo em PT-BR explicando contexto e detalhes.
   Refs .specs/NNN-slug.md
   ```
7. `git push -u origin feat/<slug>`
8. `gh pr create --base dev --title "<título em PT-BR>" --body "..."`
9. Aguardar CI verde
10. Pedir review (skill `review-pr` automatiza)
11. Merge é **decisão humana** — após CI verde + review aprovado

### Conventional Commits

Tipos: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `style`, `build`, `ci`.

Scope: nome do app ou área (`web`, `chat`, `worker`, `infra`, `auth`, `transcribe`).

Exemplos:
```
feat(transcribe): salva timestamps em formato clicável no .md
fix(auth): corrige redirect após aprovação do admin
chore(infra): bump garage 1.0.0 → 1.0.1
docs(spec): adiciona .specs/003-painel-custos.md
```

### Release

**Pre-release em `dev`**: cada merge em `dev` dispara `version-dev.yml`, que bumpa
a versão pra `X.(Y+1).0-dev.1` (se vinha de estável) ou `X.Y.Z-dev.(N+1)` (se
já era dev). Commit `chore: pre-release vX.Y.Z-dev.N` é pushed em `dev`.
**Não cria tag** — só identifica builds em ambiente de dev.

**Release estável em `main`**: PR de `dev` → `main` com label
`release:patch|minor|major`. `version-main.yml` limpa o sufixo `-dev.N`,
bumpa o componente correspondente, commita `chore: release vX.Y.Z` e cria a
tag `vX.Y.Z`. A tag dispara `release.yml` (build + push de imagens pro ghcr).

## Estilo de código

### TypeScript (`apps/web`)

- **ESLint** + **Prettier** (configs no `apps/web/`)
- Async/await sobre Promises
- Sem `any` — usar `unknown` + narrowing
- Validação de input com Zod em TODOS os handlers
- Path aliases `@/` configurados no `tsconfig.json`
- Componentes React em PascalCase, hooks em camelCase com prefixo `use`

### Python (`apps/chat`, `apps/worker`)

- **Ruff** (lint + format) + **mypy** (strict)
- Async/await
- Type hints obrigatórios (mypy strict valida)
- Validação com Pydantic
- Logs com `structlog`
- Tests com pytest + pytest-asyncio

## Debugging

- Logs: `make logs` (todos) ou `docker compose logs -f web` (um serviço)
- Hot reload: `apps/web/src` é bind-mountado em dev (override compose); editar local reflete no container
- DB inspect: `make shell-db`
- Redis inspect: `make shell-redis`
- Garage inspect: `docker compose exec garage /garage status`

## Trabalhando com a IA (Claude/Codex)

`CLAUDE.md` na raiz define regras. Resumo do uso esperado:

- **Modo Pesquisa**: pra discutir abordagens. IA não deve pular pra código.
- **Modo Implementação**: instruções diretas. IA segue checklist pre-PR.
- **Skills** em `.claude/skills/`: fluxos reutilizáveis (`spec`, `ship`, `audit`, `release`, etc.)
- **SDD obrigatório** pra features não-triviais — IA deve usar skill `spec` antes de codar

## Troubleshooting

| Sintoma | Causa provável | Fix |
|---|---|---|
| `make dev` falha no Garage | RPC secret muito curto | Garage exige RPC secret de 64 hex chars. Gere com `openssl rand -hex 32` |
| Web container reinicia em loop | Master key não montou | `docker compose logs master-key-init` — verifica se rodou OK |
| Worker não pega jobs | Redis password errado | Conferir `REDIS_URL` no compose vs `REDIS_PASSWORD` |
| Migration falha | Schema drift | `pnpm prisma migrate reset` (DEV ONLY — perde dados) |
| FTS retorna vazio | Trigger não rodou | Verificar trigger `transcript_search_vector_update` no DB |
