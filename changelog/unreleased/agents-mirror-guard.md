---
tipo: chore
titulo_en: CI now blocks a pull request that updates only one of the two agent rule trees
titulo_pt_br: CI passa a barrar PR que atualiza só uma das duas árvores de regras de agente
---

The repository keeps `.agents/` as a mirror of `.claude/`, because that is the
tree Codex loads. Nothing verified it, and the trees drifted silently once: a
pull request added skill frontmatter to `.claude/` alone and it went unnoticed
until a reviewer compared them by hand. Left alone, the two harnesses end up
following different rules.

A guard now compares both trees, ignoring only the mandated `.claude/` to
`.agents/` path rewrite and any line-ending difference. It runs as a test inside
the already-required `Test TS (apps/web)` check, so a pull request touching one
tree without the other fails before merge. `node scripts/agents-mirror.mjs --fix`
regenerates the mirror, and `node scripts/agents-mirror.mjs` reports drift
without changing anything.

<!-- pt-BR -->

O repositório mantém `.agents/` como espelho de `.claude/`, porque é essa a
árvore que o Codex carrega. Nada verificava isso, e as duas se desencontraram em
silêncio uma vez: um PR adicionou frontmatter de skill só em `.claude/` e
ninguém percebeu até alguém comparar à mão. Sem correção, os dois harnesses
acabam seguindo regras diferentes.

Agora um guard compara as duas árvores, ignorando apenas a reescrita de path
obrigatória de `.claude/` para `.agents/` e diferenças de fim de linha. Ele roda
como teste dentro do check `Test TS (apps/web)`, que já era obrigatório, então PR
que mexe numa árvore só falha antes do merge. `node scripts/agents-mirror.mjs --fix`
regenera o espelho, e `node scripts/agents-mirror.mjs` aponta a divergência sem
alterar nada.
