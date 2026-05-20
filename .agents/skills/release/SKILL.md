# Release — Preparar PR de Release (dev → main)

Automatiza a preparação de uma PR de release coletando tudo que foi mergeado em `dev` desde a última release.

## Inputs

- Label de release: `release:patch`, `release:minor`, ou `release:major`
- Notas adicionais (opcional): contexto extra para o corpo da PR

## Fluxo

### 1. Identificar Escopo

```bash
# Último release tag ou merge em main
git log main --oneline -1
LAST_RELEASE_SHA=$(git rev-parse main)

# PRs mergeadas em dev desde última release
gh pr list --state merged --base dev --search "merged:>=YYYY-MM-DD" --json number,title,labels,mergedAt,author

# Diff stats
git diff main...dev --stat
```

### 2. Categorizar Mudanças

Agrupar PRs mergeadas por tipo:
- **Funcionalidades** — PRs com label `feature` ou título com `feat`
- **Correções** — PRs com label `bug` ou título com `fix`
- **Melhorias** — PRs com label `enhancement` ou `refactor`
- **Infraestrutura** — PRs com label `infra`, `ci`, `devops`
- **Outros** — PRs sem categorização clara

### 3. Verificar Prontidão

```bash
# CI status da branch dev
gh pr checks $(gh pr list --base main --head dev --json number -q '.[0].number') 2>/dev/null

# Verificar se há PRs abertas para dev que deveriam entrar
gh pr list --state open --base dev --json number,title
```

Se houver PRs abertas para dev que parecem relevantes para a release, listar e perguntar se devem ser esperadas.

### 4. Criar PR de Release

```bash
gh pr create --base main --head dev \
  --title "Release [versão] — [resumo curto]" \
  --label "release:patch|minor|major" \
  --body "$(cat <<'EOF'
## Release [versão]

### Funcionalidades
- PR #N — título

### Correções
- PR #N — título

### Melhorias
- PR #N — título

### Números
- X PRs incluídas
- +Y/-Z linhas
- Período: [data início] a [data fim]

### Notas
[notas adicionais se fornecidas]
EOF
)"
```

### Regras

- NUNCA mergear a PR de release — apenas criar e reportar o link
- Corpo da PR em PT-BR
- Se houver migrations novas no período, destacar na seção de notas como alerta
- Se a diff for muito grande (>50 arquivos), sugerir ao usuário revisar por área
