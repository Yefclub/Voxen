---
name: ci-status
description: Use quando perguntarem sobre o estado das PRs ou do CI ("como estão as PRs?", "o CI passou?", "tem PR travada?", "espera o CI") — panorama de PRs abertas, checks e saúde do pipeline, mais o padrão de espera robusta de CI que precede qualquer merge.
---

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

## Espera de CI (antes de mergear)

NÃO confiar em `gh pr checks <num>` cru pra decidir merge: o exit code é `0` só quando todos passaram e `8` para "qualquer pendente **ou** falho" (não diferencia), e a saída pode incluir checks de runs cancelados antigos. Usar `statusCheckRollup` e esperar **terminar** antes de decidir.

⚠️ **Dois furos REAIS que já causaram "verde falso" + merge recusado ("X of Y required status checks are expected"):**

1. **Lag de replicação / rollup vazio.** Logo após um `git push`, o `statusCheckRollup` pode (a) ainda refletir o **commit anterior** (verde do commit velho) ou (b) vir **vazio** porque os checks ainda não registraram. Contar "0 pendentes" num rollup vazio ou velho = verde falso. **Sempre exigir que os checks estejam REGISTRADOS no head ATUAL**: `total >= (nº de required checks)` **E** `pendentes == 0` **E** `falhas == 0`, e confirmar o head com `gh pr view <num> --json headRefOid`.
2. **Push que não dispara CI.** Às vezes o evento `synchronize` não gera run (hiccup do Actions). Sintoma: `gh run list --branch <branch>` não mostra run pro head novo. **Fix:** forçar com `gh pr close <num> && gh pr reopen <num>` (dispara `reopened`).

Antes de mergear, o gate final é `mergeStateStatus == CLEAN` (não só "checks verdes").

```bash
# Espera robusta (rodar com run_in_background: true)
for i in $(seq 1 70); do
  total=$(gh pr view <num> --json statusCheckRollup -q '.statusCheckRollup|length')
  pend=$(gh pr view <num> --json statusCheckRollup -q '[.statusCheckRollup[]|select(.status!="COMPLETED")]|length')
  fail=$(gh pr view <num> --json statusCheckRollup -q '[.statusCheckRollup[]|select(.conclusion=="FAILURE" or .conclusion=="CANCELLED" or .conclusion=="TIMED_OUT")]|length')
  [ -n "$fail" ] && [ "$fail" != "0" ] && { echo "FALHOU"; exit 1; }
  [ "${total:-0}" -ge 9 ] && [ "${pend:-1}" = "0" ] && { echo "VERDE E REGISTRADO"; exit 0; }
  sleep 30
done
```

Avisar no chat ("ativei poll de CI em background, aviso quando voltar"). Entre dois merges seguidos, a branch protection exige `gh api -X PUT repos/Yefclub/Voxen/pulls/<num>/update-branch` antes do segundo merge (se a branch ficou atrás do `dev`).
