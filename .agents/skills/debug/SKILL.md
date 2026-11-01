---
name: debug
description: Use quando algo quebrou ou travou ("investiga esse erro", "por que falha?", "tá pronto?") — reproduz primeiro com evidência observada, isola a causa antes de corrigir e só declara conclusão com checagem atual, nunca com relato de sucesso não verificado.
---

# Debug — reproduzir, isolar, concluir com evidência

Depuração sistemática: sem reprodução não há diagnóstico; sem checagem atual não há "pronto". Corrige a causa, não o sintoma.

## Quando usar

- Erro, falha de teste/CI, comportamento inesperado, flake suspeito.
- Antes de declarar qualquer entrega concluída (verificação de conclusão).
- Quando a "correção óbvia" já foi tentada e não resolveu.

## Fluxo

### 1. Reproduzir com evidência observada

- Comando exato + saída completa (não resumo de memória). Sem reprodução local, investigar o log real da execução que falhou — nunca inferir a causa pelo sintoma.
- Registrar: onde falha, com que entrada, com que frequência (sempre/intermitente/uma vez).
- Flake suspeito: rodar N vezes e contar; intermitente sem contagem continua suspeito.

### 2. Isolar antes de corrigir

- Estreitar: qual camada (rede, DB, storage, auth, contrato, runtime), qual commit introduziu (bisect/log quando preciso).
- Uma hipótese por vez; cada hipótese prevê um teste que a confirma ou refuta.
- Não corrigir dois candidatos de uma vez — correção múltipla esconde a causa real.

### 3. Corrigir a causa e provar

- Menor mudança que elimina a reprodução; sem refator junto.
- Re-rodar a reprodução original: passou? Rodar a suíte afetada: verde?
- Se a correção exige teste novo, ele precisa falhar sem a correção (TDD de bug).

### 4. Concluir só com checagem atual

- "Pronto" = comando executado agora com saída verificada (teste, CI verde no HEAD atual, comportamento observado).
- Nunca declarar conclusão com base em relato ("disse que passou"), run antiga, ou ambiente diferente do alvo.
- Deixar rastro: causa raiz, correção, evidência (comando + saída), e o que observar se voltar.

## O que esta skill NÃO faz

- Não aplica workaround permanente para sintoma sem registrar a causa como débito (com issue).
- Não substitui `test-audit` (contrato dos testes), `review-pr` (revisão do diff) nem `ci-status` (leitura do CI).
- Não conclui por analogia ("funcionou no caso X, então aqui também").
