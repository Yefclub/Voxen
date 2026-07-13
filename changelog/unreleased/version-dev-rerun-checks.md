---
tipo: fix
titulo: Atualizações automáticas passam por todos os checks da PR
---

O bump de desenvolvimento agora reexecuta CI, segurança e validação de changelog
no contexto da própria PR. Isso permite publicar a nova versão e suas novidades
sem deixar o rollup preso em aprovação manual.
