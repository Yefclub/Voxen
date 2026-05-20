# Changelog — Resumo de Atividade para Gestão

Gera um resumo executivo de atividade do projeto para stakeholders/gestão.

## Inputs

- Período: `semana`, `mês`, `sprint`, ou datas específicas (`2026-03-01..2026-03-15`)
- Formato (opcional): `markdown`, `monday`, `email` (default: markdown)
- Filtro (opcional): área específica do projeto

## Fluxo

### 1. Coletar Dados

```bash
# PRs mergeadas no período
gh pr list --state merged --search "merged:>=YYYY-MM-DD" --json number,title,mergedAt,author,labels,additions,deletions

# Issues fechadas no período
gh issue list --state closed --search "closed:>=YYYY-MM-DD" --json number,title,closedAt,labels

# Commits no período (para stats)
git log --since="YYYY-MM-DD" --until="YYYY-MM-DD" --oneline --shortstat
```

### 2. Categorizar

Agrupar por área:
- Funcionalidades novas
- Correções de bugs
- Melhorias de UI/UX
- Infraestrutura/DevOps
- Segurança
- Performance

### 3. Gerar Resumo

Estrutura do output:

```markdown
# Changelog — [Período]

## Destaques
- (3-5 itens mais impactantes, linguagem não-técnica)

## Funcionalidades
- PR #N — descrição curta

## Correções
- PR #N — descrição curta

## Melhorias
- PR #N — descrição curta

## Números
- X PRs mergeadas
- Y issues fechadas
- +Z/-W linhas de código
```

### Regras

- Linguagem em PT-BR, tom profissional e acessível para não-técnicos
- Destaques devem focar no valor entregue, não no detalhe técnico
- Sem jargão de código nos destaques (dizer "nova funcionalidade de calendário" e não "implementou CalendarStore com React Query")
- Se formato for `monday`, formatar como bullet points compatíveis com updates do Monday.com
- Se formato for `email`, incluir saudação e fechamento
