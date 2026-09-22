---
tipo: fix
titulo_en: X posts are captured from the public source before the model analyzes them
titulo_pt_br: Posts do X são capturados da fonte pública antes da análise do modelo
---

X ingestion now retrieves the public post text, author, date, metrics, and
media directly from the source before asking the model to analyze it. When the
model cannot retrieve the post, the captured content is preserved instead of
storing an answer that only describes the failure. If neither path can reach
the post, the ingestion fails with an actionable message instead of leaving a
summary built on a failure narrative.

<!-- pt-BR -->

A ingestão do X agora recupera texto, autor, data, métricas e mídia do post
público direto da fonte antes de pedir a análise ao modelo. Quando o modelo não
consegue recuperar o post, o conteúdo capturado é preservado em vez de guardar
uma resposta que só descreve a falha. Se nenhum dos caminhos alcançar o post, a
ingestão falha com uma mensagem acionável em vez de deixar um resumo construído
sobre uma narrativa de falha.
