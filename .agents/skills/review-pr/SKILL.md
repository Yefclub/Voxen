# Review PR

Skill para revisão técnica de Pull Requests.

## Quando usar

Invocado automaticamente pelo fluxo de implementação paralela (worktrees), ou manualmente via `/review-pr <número>`.

## Inputs

- Número da PR (obrigatório)
- Contexto adicional da issue (opcional — o agente busca via `gh`)

## Fluxo

### 1. Aguardar CI

```bash
gh pr checks <PR_NUMBER> --watch --fail-fast
```

Se CI falhar, reportar os erros e parar. Não prosseguir com review de PR com CI vermelho.

### 2. Coletar Contexto

```bash
gh pr view <PR_NUMBER> --json title,body,baseRefName,headRefName,files,additions,deletions
gh pr diff <PR_NUMBER>
```

Se a PR referencia uma issue (`Closes #N`), ler a issue:
```bash
gh issue view <ISSUE_NUMBER>
```

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
## Review: PR #<N> — <título>

**Status CI**: Passou / Falhou
**Arquivos**: X alterados (+Y/-Z linhas)

### Aprovação
- [ ] Código correto e alinhado com a issue
- [ ] Tipagem TypeScript adequada
- [ ] Sem vulnerabilidades de segurança
- [ ] Testes presentes para lógica alterada
- [ ] Escopo respeitado (sem mudanças fora do contexto)
- [ ] Migrations sincronizadas (se aplicável)

### Problemas Encontrados
(listar, ou "Nenhum problema encontrado")

### Sugestões (não-bloqueantes)
(listar, ou "Nenhuma sugestão")

### Veredicto: APROVADO / MUDANÇAS NECESSÁRIAS
```

Se APROVADO, não fazer nada além de reportar. Merge é decisão humana.
Se MUDANÇAS NECESSÁRIAS, listar exatamente o que precisa ser corrigido.
