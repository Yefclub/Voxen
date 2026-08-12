---
tipo: chore
titulo_en: The AI SDK is back on a current patch release
titulo_pt_br: O AI SDK volta a uma versão de patch atual
---

The `ai` package, which runs the whole agent loop — tool approvals, timeout
budgets and streaming — had been pinned forty patch releases behind, with that
many releases of fixes sitting unapplied on the most critical dependency in the
app.

Catching up changed one behaviour the chat depended on: the newer package
delivers empty text chunks that the old one filtered out, which would have split
a single stretch of reasoning into two separate blocks. That is handled, so the
reasoning panel keeps behaving as before.

It is now current. The dependency automation was also regrouped so this cannot
happen the same way again: routine updates from the same family now arrive as
one pull request instead of one each, which stops a handful of parked reviews
from blocking every other update behind them.

<!-- pt-BR -->

O pacote `ai`, que roda todo o laço do agente — aprovação de ferramenta, orçamento
de timeout e streaming —, estava travado quarenta releases de patch atrás, com
essa quantidade de correções paradas na dependência mais crítica do app.

Atualizar mudou um comportamento do qual o chat dependia: a versão nova entrega
pedaços de texto vazios que a antiga filtrava, o que partiria um raciocínio
contínuo em dois blocos separados. Isso foi tratado, então o painel de raciocínio
continua se comportando como antes.

Agora está atualizado. A automação de dependências também foi reagrupada para
que isso não se repita do mesmo jeito: atualização de rotina da mesma família
passa a chegar numa PR só em vez de uma cada, o que impede que um punhado de
revisões paradas trave todas as outras atualizações atrás delas.
