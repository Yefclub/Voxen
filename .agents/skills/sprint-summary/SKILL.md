# Sprint Summary — Radiografia Técnica do Projeto

Gera um resumo técnico do estado atual do projeto para o desenvolvedor. Diferente do changelog (para gestão), esse é para tomada de decisão técnica.

## Inputs

- Período (opcional): default última semana
- Foco (opcional): área específica (módulo, camada, etc.)

## Fluxo

### 1. Coletar Estado Atual

```bash
# PRs abertas
gh pr list --state open --json number,title,headRefName,createdAt,labels,reviews,statusCheckRollup

# Issues abertas por label/prioridade
gh issue list --state open --json number,title,labels,assignees,createdAt

# CI status das PRs abertas
gh pr list --state open --json number,title,statusCheckRollup

# PRs mergeadas no período
gh pr list --state merged --search "merged:>=YYYY-MM-DD" --json number,title,mergedAt,additions,deletions

# Branches ativas
git branch -r --sort=-committerdate | head -20
```

### 2. Analisar

- Quais PRs estão bloqueadas (CI vermelho, sem review, conflitos)
- Issues sem assignee ou sem atividade
- Branches stale (sem commit há mais de 7 dias)
- Dívida técnica acumulando (issues com label de tech-debt)

### 3. Gerar Relatório

```markdown
# Sprint Summary — [Período]

## Estado Geral
- X PRs abertas (Y com CI verde, Z bloqueadas)
- W issues abertas (N sem assignee)

## Entregue no Período
- PR #N — título (+/-linhas)

## Bloqueado / Precisa de Atenção
- PR #N — motivo (CI falhou em: ..., conflito com: ..., sem review há X dias)

## Issues Prioritárias Abertas
- #N — título [label]

## Branches Stale
- branch-name (último commit há X dias)

## Sugestão de Próximos Passos
- (baseado no que está bloqueado e no que tem prioridade)
```

### Regras

- Linguagem técnica e direta — esse relatório é para o dev, não para gestão
- Sempre incluir links clicáveis para PRs e issues
- Sugestão de próximos passos deve ser baseada nos dados, não genérica
- Se encontrar worktrees órfãs durante a análise, listar para limpeza
