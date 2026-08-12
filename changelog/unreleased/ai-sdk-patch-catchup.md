---
tipo: chore
titulo_en: The AI SDK is back on a current patch release
titulo_pt_br: O AI SDK volta a uma versão de patch atual
---

The `ai` package, which runs the whole agent loop — tool approvals, timeout
budgets and streaming — had been pinned forty patch releases behind. Nothing was
broken by it, but forty releases of fixes were sitting unapplied on the most
critical dependency in the app.

It is now current. The dependency automation was also regrouped so this cannot
happen the same way again: routine updates from the same family now arrive as
one pull request instead of one each, which stops a handful of parked reviews
from blocking every other update behind them.

<!-- pt-BR -->

O pacote `ai`, que roda todo o laço do agente — aprovação de ferramenta, orçamento
de timeout e streaming —, estava travado quarenta releases de patch atrás. Nada
quebrou por causa disso, mas eram quarenta releases de correção paradas na
dependência mais crítica do app.

Agora está atualizado. A automação de dependências também foi reagrupada para
que isso não se repita do mesmo jeito: atualização de rotina da mesma família
passa a chegar numa PR só em vez de uma cada, o que impede que um punhado de
revisões paradas trave todas as outras atualizações atrás delas.
