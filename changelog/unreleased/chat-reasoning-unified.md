---
tipo: fix
titulo: Raciocínio da Vox corrigido e unificado com as ferramentas
---

O raciocínio da Vox (o "pensando" que aparece antes da resposta) agora é enviado
corretamente para o modelo — o parâmetro que pedia esforço de raciocínio estava no
formato errado para o OpenRouter e vinha sendo descartado silenciosamente pelo SDK,
o que fazia o raciocínio aparecer de forma inconsistente.

Na interface, raciocínio e ferramentas agora vivem dentro de um único bloco
"Pensando" / "Pensou por Xs", em vez de duas caixas separadas (raciocínio sempre
em cima, ferramentas sempre embaixo). Com o agente rodando várias etapas de
raciocínio intercaladas com buscas e leituras, o bloco agora mostra tudo na ORDEM
real em que aconteceu — cada nova ferramenta ou novo trecho de raciocínio aparece
na posição cronológica certa, então dá pra acompanhar o trabalho acontecendo em
tempo real em vez de ver uma caixa de raciocínio parada no topo enquanto o resto
roda embaixo, sem relação visual entre os dois.

Também corrigimos o botão "Ir ao mais recente" (aparecia esticado e mal
centralizado por um bug de CSS) e trocamos o ícone de enviar mensagem de avião de
papel para uma seta para cima.
