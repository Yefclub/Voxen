# Contribuindo com o Voxen

Obrigado por querer contribuir. O Voxen e um projeto self-hosted com foco em instalacao simples, soberania de dados e manutencao segura. Contribuicoes sao bem-vindas quando preservam esses principios.

## Antes de comecar

- Leia o [README](README.md), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/SECURITY.md](docs/SECURITY.md).
- Para bugs, abra uma issue com passos de reproducao.
- Para features maiores, abra uma issue primeiro para alinhar escopo antes de implementar.
- Para vulnerabilidades, siga [SECURITY.md](SECURITY.md) e nao abra issue publica.

## Fluxo de branches

- `main`: branch default e de release. Protegida.
- `dev`: branch de integracao. Protegida.
- PRs de feature/correcao devem mirar `dev`.
- PRs para `main` sao apenas releases e precisam de uma label `release:patch`, `release:minor` ou `release:major`.

Use branches com prefixo claro:

```bash
feat/minha-feature
fix/meu-bug
docs/minha-doc
chore/minha-manutencao
```

## Setup local

Prerequisitos minimos:

- Docker + Docker Compose v2
- Git

```bash
git clone https://github.com/Yefclub/Voxen.git
cd Voxen
make dev
```

Opcional para rodar tooling fora dos containers:

- Bun 1.2+
- pnpm 9+
- Python 3.13
- uv

## Qualidade antes do PR

Rode os checks mais relevantes antes de abrir PR:

```bash
make format-check
make lint
make typecheck
make test
docker compose build
```

Para aplicar formatacao automaticamente:

```bash
make format
```

## Estilo de codigo

TypeScript:

- ESLint + Prettier.
- Evite `any`; prefira `unknown` com narrowing.
- Valide entrada de API com Zod.
- Mantenha handlers pequenos e testaveis.

Python:

- Ruff para lint e format.
- mypy strict.
- Type hints obrigatorios em codigo de app.
- Validacao com Pydantic quando dados cruzam fronteiras.

## Testes

- `apps/web/tests`: testes Bun/Vitest para web/API.
- `apps/chat/tests`: pytest do servico de chat.
- `apps/worker/tests`: pytest do worker.

Inclua teste quando corrigir bug ou mudar comportamento. Para mudancas de schema, inclua migration Prisma e teste de fluxo quando fizer sentido.

## Commits

Use Conventional Commits:

```text
feat(web): adiciona filtro de jobs
fix(worker): corrige retry de transcricao
docs(deploy): documenta Cloudflare Tunnel
ci(security): atualiza scanner de secrets
```

Titulos podem ser em ingles ou portugues, mas mantenha o tipo/scope em formato convencional.

## Pull requests

Um bom PR:

- Explica problema e solucao.
- Lista arquivos/areas criticas.
- Inclui plano de testes executado.
- Atualiza docs quando muda comportamento, deploy, seguranca ou workflow.
- Mantem escopo pequeno o suficiente para review.

Mudancas grandes devem nascer de uma spec em `.specs/NNN-slug.md` ou de uma issue discutida previamente.

## Licencas de dependencias

Novas dependencias devem ter licenca permissiva, como MIT, Apache-2.0, BSD ou ISC. Evite GPL, AGPL, SSPL ou licencas que possam impor obrigacoes incompatíveis com o projeto.

