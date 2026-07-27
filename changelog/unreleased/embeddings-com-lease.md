---
tipo: fix
titulo: Brain mantém embeddings consistentes durante atualizações
---

Quando os embeddings opcionais são atualizados, a Voxen agora coordena essa escrita com a atualização do Brain. Isso evita que um embedding concorra com a reconstrução do mapa de conhecimento do mesmo usuário.

Se a coordenação estiver ocupada ou indisponível, o embedding é ignorado com segurança e pode ser atualizado em uma próxima execução, sem deixar o Brain em estado parcial.
