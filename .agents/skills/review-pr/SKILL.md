---
name: review-pr
description: Use quando um commit local precisar de revisão técnica antes do push ("revisa antes de empurrar", "esse diff está ok?"), ou quando uma PR já aberta precisar de revisão ("revisa a PR 42") — analisa diff, tipagem, segurança, testes, escopo, migrations e alinhamento com a spec, e devolve veredito APROVADO ou MUDANÇAS NECESSÁRIAS ao Claude principal, sem comentar na PR.
---

# Review PR

Skill para revisão técnica de um diff, antes do push ou de uma PR já aberta.

## Quando usar

**Modo padrão — commit local, antes do push.** É o passo 5 do fluxo Git do `CLAUDE.md` e o passo 4 da skill `ship`. Achado pego aqui não custa ciclo de runner; achado pego depois do push custa um CI inteiro.

**Modo PR — diff de uma PR já aberta.** Para revisar contribuição de terceiro, ou re-revisar um commit de fix empurrado depois de um CI vermelho.

Também é invocada pelo fluxo de implementação paralela (skill `batch-issues`), sempre no modo local.

## Inputs

- **Modo local**: branch com commits ainda não empurrados (default) — nenhum argumento obrigatório
- **Modo PR**: número da PR
- Contexto adicional da issue (opcional — o agente busca via `gh`)

## Fluxo

### 1. Coletar o diff

**Modo local** (padrão):

```bash
git fetch origin
git log --oneline origin/dev..HEAD          # commits sob revisão
git diff origin/dev...HEAD                  # diff completo
git diff --stat origin/dev...HEAD
```

Confirmar que há commits a revisar. Nenhum commit à frente de `origin/dev` = nada a revisar, reportar e parar. Não é preciso esperar CI nenhum — o objetivo é justamente não gastar runner.

**Modo PR**:

```bash
gh pr view <PR_NUMBER> --json title,body,baseRefName,headRefName,files,additions,deletions,statusCheckRollup
gh pr diff <PR_NUMBER>
```

Aqui o CI pode já ter rodado. Se estiver vermelho, reportar os checks que falharam junto com a review — não é motivo pra parar, mas entra no relatório.

Se há issue referenciada (`Closes #N`), ler:
```bash
gh issue view <ISSUE_NUMBER>
```

### 2. Delimitar o escopo antes de analisar

Reportar **apenas**: defeito introduzido pelo diff, quebra de comportamento existente, e lacuna do que a issue/spec pede.

Ignorar: melhoria adjacente, refatoração fora de escopo, e problema pré-existente que o diff não agravou. Sem esse limite o revisor traz achado legítimo porém periférico, cada um vira discussão, e o sinal — o que **este** diff precisa antes de subir — some no volume.

Revisor não edita. Leitura e análise apenas.

### 3. Análise do Diff

Para cada arquivo alterado, verificar:

- **Correção**: O código faz o que a PR/issue descreve?
- **Tipos**: Tipagem TypeScript correta, sem `any` desnecessário
- **Segurança**: Sem SQL injection, XSS, secrets expostos, OWASP top 10
- **Testes**: Mudanças de lógica têm testes correspondentes?
- **Escopo**: A PR não toca arquivos fora do escopo da issue?
- **Migrations**: Se há mudança no schema do banco, há migration correspondente?

### 4. Verificações Extras

<!-- CUSTOMIZE: Adicione verificações específicas do seu projeto. Exemplos: -->

- Se a PR altera o schema do banco, verificar se existe migration correspondente
- Se a PR altera rotas/controllers, verificar se auth guards estão presentes
- Se a PR altera state management, verificar se não há subscrições desnecessárias
- Se a PR altera schemas de validação, verificar se batem com a implementação

### 5. Output

Retornar relatório estruturado:

```
## Review: <branch ou PR #N> — <título/assunto>

**Alvo**: commit local `<sha>` (pré-push) | PR #<N>
**Status CI**: n/a (pré-push) | Passou | Falhou
**Arquivos**: X alterados (+Y/-Z linhas)

### Aprovação
- [ ] Código correto e alinhado com a issue
- [ ] Tipagem TypeScript adequada
- [ ] Sem vulnerabilidades de segurança
- [ ] Testes presentes para lógica alterada
- [ ] Escopo respeitado (sem mudanças fora do contexto)
- [ ] Migrations sincronizadas (se aplicável)

### Problemas Encontrados
(listar com arquivo e linha, ou "Nenhum problema encontrado")

### Sugestões (não-bloqueantes)
(listar, ou "Nenhuma sugestão")

### Veredicto: APROVADO / MUDANÇAS NECESSÁRIAS
```

## Regras

- **NUNCA comentar na PR.** Nada de `gh pr comment`, `gh pr review` ou `gh issue comment`. O relatório volta pro Claude principal, e é ele que decide o que fazer.
- **Nunca auto-aprovar.** Quem implementou não revisa o próprio diff — a review roda em subagente de contexto limpo.
- Se APROVADO, só reportar. Se MUDANÇAS NECESSÁRIAS, listar exatamente o que corrigir, com arquivo e linha.
- **Achado em escopo se corrige antes do push** (modo local) ou **antes do merge** (modo PR), independente do rótulo de severidade. Follow-up adiado é dívida que raramente volta, e corrigir com contexto quente custa uma fração de reabrir depois.
- **Sinal de parada**: review na 3ª rodada trazendo casos cada vez mais periféricos é problema de escopo, não de qualidade. Fechar com o que está correto e reportar o que ficou de fora.
