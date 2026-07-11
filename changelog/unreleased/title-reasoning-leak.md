---
tipo: fix
titulo: Títulos deixam de vazar o "raciocínio" do modelo
---

Alguns conteúdos (posts do X, páginas web) recebiam como título o preâmbulo do
modelo — coisas como "The candidate title is…" ou "The user wants a final
title…", às vezes truncadas no meio. Agora a geração de título desabilita o
modo de raciocínio do modelo e rejeita qualquer resposta que pareça preâmbulo,
caindo no título original quando isso acontece.
