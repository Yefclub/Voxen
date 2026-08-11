---
tipo: fix
titulo_en: Reliable deletion during graph activity
titulo_pt_br: Exclusão confiável durante atividades do grafo
---

Background knowledge deletion now returns to the durable queue with a short
delay while another operation holds the user's graph lease. Temporary graph
activity no longer turns a valid deletion into a failed job or blocks unrelated
worker tasks indefinitely.

<!-- pt-BR -->

A exclusão de conhecimento em segundo plano agora retorna para a fila durável
com um pequeno atraso enquanto outra operação mantém o lease do grafo do
usuário. Atividades temporárias do grafo não transformam mais uma exclusão
válida em falha nem bloqueiam indefinidamente outras tarefas do worker.
