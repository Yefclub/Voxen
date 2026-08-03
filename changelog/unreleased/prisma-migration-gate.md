---
tipo: infra
titulo: Gate de migrations protege o histórico do banco
---

Pull requests agora preservam o histórico integrado do Prisma, exigem uma nova
migration ordenada para mudanças de schema e reproduzem toda a evolução em um
PostgreSQL isolado. O CI também detecta divergências em relação ao modelo atual
e publica diagnósticos sem credenciais para orientar a correção.
