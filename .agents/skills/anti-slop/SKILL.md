---
name: anti-slop
description: Use antes de commitar ou abrir PR ("esse diff está limpo?", "tem coisa sobrando?") — verifica se cada mudança é atribuível ao pedido, sem refactors alheios, abstrações mortas ou falhas silenciosas, com evidência em vez de alegação.
---

# Anti-slop — diff atribuível ao pedido

Higiene pré-commit: cada hunk precisa responder "qual parte do pedido exige isto?". Complementa `review-pr` (que julga correção) julgando necessidade e atribuição.

## Quando usar

- Antes de commitar ou abrir PR, depois do trabalho mecânico pronto.
- Quando um diff cresceu além do pedido ("só mais esse ajuste").
- Nunca como substituto de `review-pr`, lint, typecheck ou CI verde.

## Fluxo

### 1. Atribuir cada hunk

Para cada arquivo do diff (`git diff --stat` + hunks):

- **Exigido pelo pedido**: citar issue/spec/seção.
- **Suporte inevitável**: teste, migration, doc ou contrato que o pedido implica.
- **Sobrando**: mover para outro branch/PR ou descartar.

### 2. Caçar falhas silenciosas

- `|| true`, `catch {}` vazio, `2>/dev/null` sem justificativa — cada um precisa provar que não mascara falha real. Caso real do repo: `|| true` no fim de um `RUN` mascarou `npm` quebrado e publicou imagem sem prisma, sem usuário e sem `/data/storage`.
- Fallback que inventa dado (placeholder, texto fabricado) onde o contrato exige erro explícito.
- `TODO` sem issue, código comentado, log esquecido.

### 3. Caçar abstração morta

- Helper usado uma vez, camada que só repassa, flag que ninguém lê, teste que só repete a implementação (ver skill `test-audit`).
- Renomeação ou reformat fora do escopo do pedido.

### 4. Checar alegações

- "Melhora performance/latência": só com medição antes/depois nas condições documentadas.
- "Sem mudança de comportamento": só com suíte relevante verde + diff de contrato vazio.
- "Trivial/óbvio": ainda precisa de evidência (comando + saída).

## Output

- Lista hunk → atribuição (pedido, suporte ou sobrando), com arquivo:linha.
- Falhas silenciosas e abstrações mortas encontradas, com correção sugerida (não aplicada).
- Veredito: **LIMPO** ou **CORTAR** (lista do que sair antes do commit).

## O que esta skill NÃO faz

- Não edita código (aponta; quem implementou corta).
- Não substitui `review-pr`, testes ou CI.
- Não bloqueia refactor legítimo exigido pelo pedido — exige apenas atribuição explícita.
