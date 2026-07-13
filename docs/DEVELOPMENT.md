# Desenvolvimento — Voxen

Como rodar localmente, testar, fazer TDD/SDD, e contribuir.

## Pré-requisitos

- `docker` + `docker compose` v2
- `git`
- Nada mais. Bun, Python, Postgres, Redis, MinIO — tudo em containers.

Opcional (pra rodar tooling fora do container, ex: prisma generate, lint local):

- `bun` 1.2+
- `pnpm` 9+
- `python` 3.13 + `uv`

## Setup inicial

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

`make dev` cria/completa `.env` se necessário e sobe tudo (postgres, redis,
minio, web, chat, worker). O bucket `voxen-transcripts` é criado
automaticamente.

Acessa `http://localhost:3000`. Primeiro cadastro vira admin → tela de setup pede OpenRouter API key + modelos default. Console MinIO: `http://localhost:9001`.

> Repositório atual: `Yefclub/Voxen` (público/open source). `main` e `dev`
> são protegidas; contribuições normais entram por PR para `dev`.

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

make lint                  # eslint + ruff check
make format                # aplica prettier + ruff format
make format-check          # verifica formatação sem alterar arquivos
make typecheck             # tsc + mypy

make migrate               # aplica migrations Prisma (cd no container web)
make seed                  # seed de dev (TBD)

make shell-db              # psql no postgres
make shell-redis           # redis-cli

make minio-init            # reroda criação do bucket MinIO (idempotente)
make master-key-show       # mostra MASTER_KEY do .env (cuidado — secret)

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

- `main` — branch default e de release (protegida, só recebe PR de release a partir de `dev`)
- `dev` — branch de integração (protegida), alvo de PRs de feature/correção
- `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `refactor/<slug>`, `docs/<slug>` — branches de feature criadas A PARTIR DE `dev`

### Fluxo

1. `git checkout dev && git pull`
2. `git checkout -b feat/<slug>`
3. Criar/atualizar `.specs/NNN-slug.md` se necessário
4. Implementar com TDD
5. `make format-check && make lint && make typecheck && make test && docker compose build`
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
chore(infra): atualiza imagem do MinIO
docs(spec): adiciona .specs/003-painel-custos.md
```

### Versioning — SemVer estável em main, prerelease em dev

`package.json` guarda a versão materializada do build. Tags estáveis usam SemVer
completo: `vX.Y.Z`. Em `dev`, cada lote pendente de merges gera uma PR automática
com versão SemVer de desenvolvimento e changelog:
`X.Y.Z-dev.<unix_epoch_seconds>`.

**Branch `dev`**:

- Toda feature entra por PR para `dev`.
- `version-dev.yml` consome `changelog/unreleased`, atualiza `releases.json` e os
  `package.json`, e abre uma PR automática contra `dev`.
- A PR automática reroda CI, Security e PR Changelog Guard no contexto do próprio
  pull request e só é mergeada quando os três workflows terminam em `success`, os
  sete required checks exatos estão verdes no head e o estado é `CLEAN`.
- Uma PR de versão obsoleta é fechada e substituída por um snapshot completo, para
  que merges concorrentes não deixem notas presas na fila.
- A imagem Easypanel em `dev` recebe tags `dev`, `dev-X.Y.Z-dev.<unix_epoch_seconds>` e `X.Y.Z-dev.<unix_epoch_seconds>`.
- O workflow nunca faz push direto em `dev` e não cria tag de prerelease.

**Release estável em `main`**:

- Prepare uma branch de release a partir de `dev`: `pnpm release:prepare patch`
  (ou `minor`/`major`) e commite `package.json` + `apps/web/package.json`.
- Abra PR para `main` com label `release:patch`, `release:minor` ou
  `release:major`.
- `pr-release-labels.yml` valida que a versão preparada bate com a label e com
  a última tag estável.
- Após o merge, `version-main.yml` cria a tag `vX.Y.Z` se ela ainda não existir
  e despacha `release.yml`, que publica imagens e GitHub Release.
- Sincronize `main` de volta em `dev` por PR normal quando houver commit de
  release que `dev` ainda não contém.

Esse fluxo é compatível com branch protection: nenhum workflow faz push direto
em `main` ou `dev`; toda alteração materializada passa por PR e required checks.

**Versão visível na UI**: `/api/version` retorna em ordem:

1. env `VOXEN_VERSION` (CI/deploy injeta build arg; dev local pode usar
   `git describe --tags --always --dirty`)
2. deploy Easypanel por GitHub source: `package.json` próxima patch +
   `DEPLOY_TIMESTAMP`, no formato `X.Y.Z-dev.<unix_epoch_seconds>`, quando há
   `GIT_SHA`
3. `package.json` como fallback estável

## Estilo de código

### TypeScript (`apps/web`)

- **ESLint** + **Prettier** (configs no `apps/web/`; comandos via `make lint`, `make format` e `make format-check`)
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
- MinIO console: `http://localhost:9001`

## Trabalhando com a IA (Claude/Codex)

`CLAUDE.md` na raiz define regras. Resumo do uso esperado:

- **Modo Pesquisa**: pra discutir abordagens. IA não deve pular pra código.
- **Modo Implementação**: instruções diretas. IA segue checklist pre-PR.
- **Skills** em `.claude/skills/`: fluxos reutilizáveis (`spec`, `ship`, `audit`, `release`, etc.)
- **SDD obrigatório** pra features não-triviais — IA deve usar skill `spec` antes de codar

## Troubleshooting

| Sintoma                        | Causa provável                | Fix                                                       |
| ------------------------------ | ----------------------------- | --------------------------------------------------------- |
| `make dev` falha no MinIO      | bucket/init falhou            | `docker compose logs minio minio-init`                    |
| Web container reinicia em loop | `MASTER_KEY` ausente/inválida | `make master-key-show` e confira se é base64 de 32 bytes  |
| Worker não pega jobs           | Redis password errado         | Conferir `REDIS_URL` no compose vs `REDIS_PASSWORD`       |
| Migration falha                | Schema drift                  | `pnpm prisma migrate reset` (DEV ONLY — perde dados)      |
| FTS retorna vazio              | Trigger não rodou             | Verificar trigger `transcript_search_vector_update` no DB |
