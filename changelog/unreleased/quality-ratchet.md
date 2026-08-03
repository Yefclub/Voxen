---
tipo: chore
titulo: Quality Gate impede regressões graduais no código
---

O CI agora compara cobertura de testes, duplicação e tamanho de arquivos com
uma linha de base versionada. A catraca permite manter ou melhorar cada métrica,
mas bloqueia novas dívidas e publica um relatório detalhado para orientar a
correção automática da pull request.
