---
tipo: fix
titulo_en: Analyze the middle of long captured content
titulo_pt_br: Análise do meio de conteúdos longos capturados
---

Long captures are analyzed in sections before their findings are synthesized.
The middle of the source is no longer omitted from AI interpretation, and the
complete original remains in the document. Oversized analysis fails explicitly
and asks for smaller parts. Cancellation stops subsequent model calls, and a
retry includes the cost of sections already processed.

<!-- pt-BR -->

Capturas longas são analisadas por seções antes da síntese dos resultados.
O meio da fonte deixa de ser omitido da interpretação por IA, e o original
completo continua no documento. Uma análise extensa demais falha de forma
explícita e pede o envio em partes menores. O cancelamento interrompe as próximas
chamadas ao modelo, e uma nova tentativa inclui o custo das seções já processadas.
