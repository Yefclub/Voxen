---
title: Jobs do worker agora se recuperam após reinícios
category: Fixed
audience: Admins
---

- Jobs em execução usam lease e heartbeat persistidos no Postgres.
- Um worker reiniciado recupera tentativas interrompidas sem deixar a Fila presa
  em 99%; após três interrupções, o job termina com uma mensagem recuperável.
- Conteúdo já persistido é retomado pelo checkpoint existente, sem criar uma
  segunda transcrição.
- Resumo, tags, embeddings e grafo não bloqueiam mais a conclusão canônica do
  job depois que o conteúdo foi salvo.
- Redis continua acelerando wakeups e progresso realtime, enquanto o Postgres é
  a fonte durável da fila.
