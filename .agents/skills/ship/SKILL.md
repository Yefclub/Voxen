# Ship — Branch, PR, CI e Merge

Fluxo completo para entregar mudanças: criar branch, commitar, abrir PR, aguardar CI, e mergear quando verde. O pedido mais comum do projeto.

## Inputs

- Descrição das mudanças (obrigatório — usado para nomear branch e PR)
- Merge automático (opcional): se o usuário disse explicitamente "faz merge se ok" → mergear após CI verde. Se não disse → apenas reportar que CI passou e aguardar instrução.

## Fluxo

### 1. Preparar Branch

```bash
# Verificar estado atual
git status --short
git branch --show-current

# Se já está numa branch de feature → usar ela
# Se está em dev/main → criar branch nova
git checkout -b <tipo>/<nome-descritivo>
```

Naming: `feat/`, `fix/`, `chore/`, `refactor/` conforme o tipo de mudança.

### 2. Commitar

```bash
# Verificar o que vai ser commitado
git diff --stat
git status --short

# Adicionar APENAS arquivos relevantes (NUNCA git add -A)
git add <arquivo1> <arquivo2> ...

# Commit com mensagem descritiva
git commit -m "<tipo>(<escopo>): <descrição concisa>"
```

Regras do commit:
- Mensagem em inglês no título (padrão conventional commits)
- Apenas arquivos alterados pelo trabalho atual
- Não incluir .env, credentials, ou arquivos pessoais

### 3. Push + PR

```bash
git push -u origin <branch>

gh pr create --base dev --head <branch> \
  --title "<título em PT-BR>" \
  --body "<corpo detalhado em PT-BR>"
```

Regras da PR:
- Título e corpo em PT-BR
- Corpo com: Contexto → O que foi feito → Detalhes técnicos → Plano de testes
- Sem emojis, sem rodapés de IA

### 4. Aguardar CI

```bash
# Esperar workflows de versionamento (se existirem)
git pull --rebase

# Monitorar CI
gh pr checks <PR_NUMBER> --watch --fail-fast
```

- Se CI falhar → reportar exatamente o que falhou, corrigir, push, repetir
- NÃO prosseguir com review ou merge com CI vermelho

### 5. Review (SEMPRE)

Após CI verde, executar a skill `review-pr` (`.agents/skills/review-pr/SKILL.md`):
- Disparar sub-agente de review em background
- Analisar diff, tipagem, segurança, testes, escopo, migrations
- Retornar relatório com veredicto: APROVADO ou MUDANÇAS NECESSÁRIAS

Se **MUDANÇAS NECESSÁRIAS** → listar o que corrigir, aguardar decisão do usuário.
Se **APROVADO** → prosseguir para o passo 6.

### 6. Merge (somente se autorizado)

Merge é opt-in — depende do que o usuário pediu:

**Se o usuário disse explicitamente "merge se ok" / "shipa" / "manda":**
```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

**Se o usuário NÃO pediu merge (default):**
Apenas reportar: "PR #N com CI verde e review aprovado. Pronta para merge quando você quiser."

### 7. Voltar para dev

```bash
git checkout dev
git pull
```

## Output Final

```
PR #N — <título>
CI: Verde
Review: Aprovado / Mudanças necessárias
Status: Mergeada / Aguardando sua aprovação
Link: <url>
```

## Regras

- NUNCA mergear sem instrução explícita do usuário — merge é preferência pessoal, não padrão do projeto
- NUNCA commitar direto em dev ou main
- SEMPRE rodar review após CI verde, mesmo para PRs pequenas
- Se houver conflito de merge, reportar ao invés de resolver silenciosamente
- Se o checklist pre-PR não foi rodado antes, rodar agora (lint, format, test, typecheck)
- Branch é deletada automaticamente após merge (--delete-branch)
