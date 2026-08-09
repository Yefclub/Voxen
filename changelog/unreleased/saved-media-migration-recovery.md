---
tipo: fix
titulo_en: Recover interrupted saved-media migrations during startup
titulo_pt_br: Recupere migrations interrompidas da biblioteca de mídia na inicialização
---

Voxen now detects the known interrupted saved-media migration, repairs and validates its
database objects idempotently, and resumes pending Prisma migrations. Unrecognized migration
failures continue to stop startup for explicit operator review.

<!-- pt-BR -->

A Voxen agora detecta a migration conhecida e interrompida da biblioteca de mídia, repara e
valida seus objetos no banco de forma idempotente e retoma as migrations pendentes do Prisma.
Falhas de migrations não reconhecidas continuam interrompendo a inicialização para revisão
explícita do operador.
