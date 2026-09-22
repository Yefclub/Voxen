---
tipo: feat
titulo_en: X transcripts can be reprocessed in place
titulo_pt_br: Transcrições do X podem ser reprocessadas no lugar
---

Submitting an X URL that already has a transcript returns the existing one, so
a failed or outdated analysis had no retry. The transcript page now offers a
reprocess action for X posts that re-runs retrieval and analysis against the
same transcript: changed content is versioned, summary and tags are rebuilt
from the new text, and dependent artifacts are invalidated. When retrieval
fails, the job fails and the transcript shows the error while keeping the
stored content. Web pages keep their existing refresh flow.

<!-- pt-BR -->

Enviar de novo uma URL do X que já tem transcrição retorna a existente, então
uma análise falha ou desatualizada não tinha como ser refeita. A página da
transcrição agora oferece reprocessar conteúdo para posts do X, repetindo
captura e análise na mesma transcrição: conteúdo alterado ganha versão, resumo
e tags são refeitos a partir do texto novo e artefatos dependentes são
invalidados. Se a captura falhar, o job falha e a transcrição mostra o erro
mantendo o conteúdo armazenado. Páginas web seguem com o fluxo de atualização
atual.
