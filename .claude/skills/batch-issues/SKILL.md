---
name: batch-issues
description: Use quando o owner passar várias issues para implementar de uma vez ("implementa essas 4 issues", lista de issues em lote) — protocolo de worktrees paralelas em 4 fases, com subagentes isolados, review local antes de cada push, limpeza obrigatória e espera de CI.
---

# Batch Issues — Implementação Paralela com Worktrees

Quando o usuário fornecer múltiplas issues para implementar em paralelo, seguir este protocolo.

## Fluxo Completo (4 fases)

**Fase 1 — Preparação**

1. Ler todas as issues via `gh issue view` — entender escopo e dependências
2. Detectar conflitos potenciais — se duas issues tocam os mesmos arquivos, avisar ANTES de iniciar

**Fase 2 — Implementação + review local, em paralelo**

3. Para cada issue, disparar um sub-agente com `isolation: "worktree"`:

- O agente recebe: número da issue, contexto completo do problema, arquivos relevantes
- O agente deve, na ordem: ler a issue → atualizar/criar spec em `.specs/` se ainda não houver → implementar → escrever testes → rodar checklist pre-PR (skill `ship`, passo 3) → **commit local, sem push**
- O agente NÃO deve modificar arquivos fora do escopo da sua issue
- A worktree é automaticamente limpa se o agente não fizer mudanças

4. Ainda dentro da fase 2, para cada worktree com commit: disparar um sub-agente de **review do commit local** (skill `review-pr`, modo local, contexto limpo).

- Quem implementou não revisa o próprio diff
- Veredicto `MUDANÇAS NECESSÁRIAS` → o agente de implementação corrige na worktree e re-submete ao review; repetir até limpo
- Só depois do review limpo: **push único → criar PR** contra `dev`

Por que aqui e não depois do CI: cada achado pego depois do push custa um ciclo de runner por PR. Num lote de 5 issues isso multiplica por 5 — é o gasto que esta ordem elimina.

**Fase 3 — Limpeza + Aguardar CI**

5. Limpar worktrees (ver seção abaixo)
6. Gerar tabela resumo parcial com status das PRs
7. Aguardar CI de todas as PRs (usar o padrão de espera robusta da skill `ci-status`, não `gh pr checks` cru)

- Se CI falhar em alguma PR, reportar quais falharam e por quê
- CI vermelho após review limpo é o caso legítimo (flake, divergência de ambiente, gate que só roda no runner): corrigir, re-revisar o commit de fix, re-empurrar

**Fase 4 — Consolidação**

8. Retornar ao Claude principal com:

   | Issue | PR  | CI  | Review | Problemas |
   | ----- | --- | --- | ------ | --------- |

9. Sinalizar PRs que toquem arquivos sobrepostos para revisão manual
10. Merge de lote é SEMPRE decisão humana — nunca mergear automaticamente um lote inteiro

## Limpeza de Worktrees (OBRIGATÓRIO)

Worktrees que não geraram mudanças são limpas automaticamente. Para as que geraram:

- Após a PR ser criada e o branch pushado, remover a worktree: `git worktree remove <path>`
- Ao final do lote, verificar com `git worktree list` que não sobrou nenhuma worktree órfã
- Se sobrar, limpar: `git worktree remove <path> --force` (só worktrees deste lote, nunca a principal)
- NUNCA deixar worktrees acumulando entre sessões

## Regras dos Sub-agentes de Implementação

- Cada sub-agente deve rodar o checklist pre-PR completo (lint, typecheck, test, build) — ver skill `ship`
- PRs criadas a partir de `dev`, direcionadas para `dev`
- Se um sub-agente falhar, reportar o erro — não silenciar
- Não tentar resolver conflitos entre PRs automaticamente — apenas reportar para revisão humana

## Regras do Agente de Review

- Roda sobre o **commit local**, antes do push — não espera CI (fase 2, passo 4)
- Usa a skill em `.claude/skills/review-pr/SKILL.md` como guia, em modo local
- Roda em background (`run_in_background: true`) para não bloquear as outras worktrees
- Contexto limpo, nunca o mesmo agente que implementou
- Retorna relatório para o Claude principal — NUNCA comenta na PR ou aprova diretamente
