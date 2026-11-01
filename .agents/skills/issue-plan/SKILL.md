---
name: issue-plan
description: Use quando um problema virar trabalho ("planeja essa issue", "qual o escopo?", "quebra em PRs") — transforma relato em problema com fonte, aceite verificável e plano de PRs, sem escrever nada remoto sem pedido e com releitura do que foi escrito.
---

# Issue Plan — do relato ao plano executável

Transforma um pedido vago em um plano que qualquer implementador consegue executar e qualquer revisor consegue verificar. Não implementa; planeja.

## Quando usar

- Antes de abrir issue ou começar feature/fix não-trivial.
- Quando o pedido mistura problema, solução e urgência na mesma frase.
- Quando um trabalho grande precisa virar PRs pequenas e ordenadas.

## Fluxo

### 1. Extrair o problema com fonte

- O que dói, onde (arquivo:linha, comando + saída, link), desde quando.
- Afirmação sem evidência volta para coleta; não vira premissa do plano.
- Registrar explicitamente o que foi verificado vs. o que é relato.

### 2. Definir aceite verificável

- Critérios binários (passa/não passa), com comando ou teste que decide.
- Não-objetivos declarados para travar scope creep.
- Rollout/rollback: como entra em `dev`, como sai se quebrar.

### 3. Dimensionar em PRs

- Uma PR por entrega revisável; ordenar por dependência e risco.
- Cada PR lista: escopo, arquivos prováveis, testes que a cobrem, o que NÃO entra.
- Migration/contrato público/CI pesado ganham PR própria quando arrastam o resto.

### 4. Escrever só com pedido explícito

- Rascunho local primeiro; `gh issue create`/`gh pr create` somente quando o owner pedir.
- Depois de escrever remoto, reler o que foi criado (`gh issue view`, `gh pr view`) e conferir título, corpo, labels e base.

## Output

- Problema com fonte, aceite verificável, não-objetivos e plano de PRs ordenado — em resposta ou `.specs/NNN-slug.md` se a skill `spec` exigir spec.

## O que esta skill NÃO faz

- Não implementa, não abre PR/issue sem pedido, não estima prazo sem base.
- Não substitui a skill `spec` (quando spec é exigida, o plano vira insumo dela).
- Não transforma chute em requisito: lacuna de evidência entra como pergunta aberta, não como premissa.
