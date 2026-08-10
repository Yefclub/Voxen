---
tipo: feat
titulo_en: Safe background deletion across the knowledge base
titulo_pt_br: Exclusão segura em segundo plano para toda a base de conhecimento
---

Knowledge deletion now runs through Voxen's durable job queue instead of holding
the browser, internal assistant, or MCP request open while storage and graph data
are removed. Transcripts, notes and note trees, saved media, library folders, and
reviewable transcript context share the same observable and retryable workflow.

The internal assistant always presents a destructive confirmation before
enqueueing a deletion. MCP clients receive a write-scoped deletion tool that
requires the user-owned target identifier, its exact current title, and an
explicit confirmation flag. Cross-workspace targets remain indistinguishable
from missing content. Transcript hard deletion requires the content to remain in
trash and is serialized against source refresh; folder cascades reject corrupted
cross-workspace trees.

The queue and job detail views now show deletion-specific progress and terminal
feedback. Graph cleanup is source-scoped, preserves unrelated manual evidence,
and invalidates the user's graph snapshot only after the background mutation.

<!-- pt-BR -->

A exclusão de conhecimento agora utiliza a fila durável de jobs da Voxen, sem
manter o navegador, a assistente interna ou uma requisição MCP esperando enquanto
o armazenamento e o grafo são limpos. Transcrições, notas e suas árvores, mídias
salvas, pastas da biblioteca e contextos revisáveis de transcrições compartilham
o mesmo fluxo observável e repetível.

A assistente interna sempre apresenta uma confirmação destrutiva antes de
enfileirar a exclusão. Clientes MCP recebem uma ferramenta com escopo de escrita
que exige o identificador pertencente ao usuário, o título atual exato e uma
confirmação explícita. Alvos de outro workspace continuam indistinguíveis de
conteúdo inexistente. A exclusão definitiva de transcrições exige que o conteúdo
permaneça na lixeira e é serializada com a atualização da fonte; cascatas de
pastas recusam árvores corrompidas entre workspaces.

A fila e os detalhes do job agora exibem progresso e resultado específicos da
exclusão. A limpeza do grafo é limitada à fonte removida, preserva evidências
manuais não relacionadas e invalida o snapshot do grafo do usuário somente após
a mutação em segundo plano.
