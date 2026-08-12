---
name: batch-issues
description: Use quando o owner passar várias issues para implementar de uma vez ("implementa essas 4 issues", lista de issues em lote) — protocolo de worktrees paralelas em 4 fases, com subagentes isolados, limpeza obrigatória, espera de CI e review automatizado por PR.
---

# Batch Issues — Implementação Paralela com Worktrees

Quando o usuário fornecer múltiplas issues para implementar em paralelo, seguir este protocolo.

## Fluxo Completo (4 fases)

**Fase 1 — Preparação**

1. Ler todas as issues via `gh issue view` — entender escopo e dependências
2. Detectar conflitos potenciais — se duas issues tocam os mesmos arquivos, avisar ANTES de iniciar

**Fase 2 — Implementação Paralela**

3. Para cada issue, disparar um sub-agente com `isolation: "worktree"`:

- O agente recebe: número da issue, contexto completo do problema, arquivos relevantes
- O agente deve: ler a issue → atualizar/criar spec em `.specs/` se ainda não houver → implementar → escrever testes → rodar checklist pre-PR → criar PR
- O agente NÃO deve modificar arquivos fora do escopo da sua issue
- A worktree é automaticamente limpa se o agente não fizer mudanças

**Fase 3 — Limpeza + Aguardar CI**

4. Limpar worktrees (ver seção abaixo)
5. Gerar tabela resumo parcial com status das PRs
6. Aguardar CI de todas as PRs (usar o padrão de espera robusta da skill `ci-status`, não `gh pr checks` cru)

- Se CI falhar em alguma PR, reportar quais falharam e por quê
- NÃO prosseguir para review de PRs com CI vermelho

**Fase 4 — Review Automatizado**

7. Para cada PR com CI verde, disparar um sub-agente de review (em background):

- O agente usa a skill `review-pr` (`.claude/skills/review-pr/SKILL.md`)
- Analisa diff, tipagem, segurança, testes, escopo, migrations, spec alinhada
- Retorna relatório estruturado com veredicto: APROVADO ou MUDANÇAS NECESSÁRIAS

8. Após todos os reviews completarem, retornar ao Claude principal com:

   | Issue | PR  | CI  | Review | Problemas |
   | ----- | --- | --- | ------ | --------- |

9. Sinalizar PRs que toquem arquivos sobrepostos para revisão manual
10. Merge é SEMPRE decisão humana — nunca mergear automaticamente

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

- Só inicia após CI verde — PR com CI vermelho não é revisada
- Usa a skill em `.claude/skills/review-pr/SKILL.md` como guia
- Roda em background (`run_in_background: true`) para não bloquear reviews de outras PRs
- Retorna relatório para o Claude principal — NUNCA comenta na PR ou aprova diretamente
