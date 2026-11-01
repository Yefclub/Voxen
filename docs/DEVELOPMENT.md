# Desenvolvimento — Voxen

Este guia cobre ambiente local, validação e contribuição segura.

## Requisitos

- Docker e Docker Compose v2
- Git

Opcional para tooling fora dos containers: Bun 1.4.4+ e Node.js 22.23.4+ com pnpm 9+.

## Ambiente local

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

`make dev` cria ou completa o `.env` da raiz e inicia Postgres, Redis, o volume local
e o web. Acesse `http://localhost:3000`; a primeira conta se torna admin.

## Comandos

```bash
make dev           # build e início do ambiente
make down          # para e preserva volumes
make update        # rebuild sem remover dados
make logs          # acompanha logs
make ps            # mostra serviços

make test          # scripts e web
make test-ts       # testes do web
make lint          # ESLint
make format-check  # Prettier
make typecheck     # TypeScript
make build         # build das imagens Compose

make migrate       # aplica migrations Prisma
make backup        # backup do Postgres, objetos e MASTER_KEY
make clean         # destrutivo: remove volumes e dados
```

## Desenvolvimento orientado por spec

Crie ou atualize `.specs/NNN-slug.md` antes de mudanças não triviais. A spec
deve registrar escopo, não objetivos, requisitos, critérios de aceite,
validação e rollout. Quando possível, reproduza o problema com um teste ou gate
falhando antes da implementação.

## Gate completo

```bash
make format-check
make lint
make typecheck
make test
docker compose config -q
docker compose build
```

Mudanças de migration também passam pelo gate Prisma. Mudanças visuais exigem
verificação local dos estados afetados e layouts responsivos. Documentação
pública deve manter links relativos válidos e as trilhas em inglês e pt-BR.

## Benchmark real de retrieval (spec 216)

`apps/web/tests/retrieval-performance.test.ts` exercita o caminho de produção
(Postgres FTS + storage + MCP) contra um corpus determinístico em português:
sinônimo, registro informal, documento longo, múltiplas fontes, material
conflitante e caso sem evidência.

```bash
DATABASE_URL=postgresql://voxen:dev@localhost:5433/voxen_test \
REDIS_URL=redis://localhost:6379 \
BETTER_AUTH_SECRET=<segredo-de-teste> MASTER_KEY=<chave-de-teste> NODE_ENV=test \
bun test apps/web/tests/retrieval-performance.test.ts
```

O teste mede recall, ordenação determinística, latência p50/p95/p99 de busca,
outline, leitura estreita e round trips MCP, além do tamanho da saída, com
limites generosos anti-flake (p95 de segundos, não metas). Métricas simuladas
do harness unitário (`retrieval-quality-benchmark.test.ts`) são reportadas em
separado e nunca como evidência de performance.

## Git e releases

- `main`: releases estáveis protegidas
- `dev`: integração protegida
- branches de trabalho: sempre criadas a partir de `dev` atualizada

Toda mudança entra primeiro em `dev`, com CI e revisão independente. O PR de
release promove `dev` para `main`; depois, `main` é sincronizada de volta para
`dev`. Título do PR e do squash de release: exatamente `vX.Y.Z`, sem corpo no
commit de squash.
