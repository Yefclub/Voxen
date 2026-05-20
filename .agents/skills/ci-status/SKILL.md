# CI Status — Panorama do CI/CD

Visão rápida do estado de todas as PRs abertas, CI, e saúde geral do pipeline.

## Inputs

- Nenhum obrigatório (default: todas PRs abertas)
- Filtro (opcional): `bloqueadas`, `prontas`, `minhas`

## Fluxo

### 1. Coletar

```bash
# PRs abertas com status de checks
gh pr list --state open --json number,title,headRefName,author,createdAt,statusCheckRollup,reviews,mergeable

# Últimas runs do CI
gh run list --limit 10 --json databaseId,displayTitle,status,conclusion,headBranch,createdAt

# Worktrees ativas (limpeza preventiva)
git worktree list
```

### 2. Classificar PRs

Para cada PR aberta:
- **CI Verde + Aprovada**: pronta para merge (decisão humana)
- **CI Verde + Sem review**: precisa de review
- **CI Vermelho**: bloqueada — listar quais checks falharam
- **CI Pendente**: em execução
- **Conflito de merge**: precisa de rebase
- **Stale**: sem atividade há mais de 3 dias

### 3. Output

```markdown
# CI Status — [Data/Hora]

## Prontas para Merge
- PR #N — título | CI | Review

## Aguardando Review
- PR #N — título | CI

## CI Falhando
- PR #N — título | [nome do check que falhou]
  - Erro: [resumo do erro]

## Em Execução
- PR #N — título | CI rodando

## Conflito de Merge
- PR #N — título | precisa rebase contra dev

## Stale (>3 dias sem atividade)
- PR #N — título (último update: X dias atrás)

## Worktrees Ativas
- [path] → branch (limpar se não necessária)

## Resumo: X abertas | Y prontas | Z bloqueadas
```

### Regras

- Ser factual — não dizer "provavelmente vai passar" se CI ainda está rodando
- Para CI vermelho, ler o log do check que falhou e dar um resumo de 1 linha do erro
- Se encontrar worktrees órfãs, listar para limpeza
- Execução deve ser rápida — não ler código, apenas consultar estado via `gh`
