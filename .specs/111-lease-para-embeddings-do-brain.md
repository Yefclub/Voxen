# 111 — Lease para embeddings do Brain

## Contexto

O worker grava embeddings opcionais no `metadata` do nó `CONTENT` do Voxen Brain. Essa mutação ocorre fora do lease Redis que já serializa a materialização do Brain, podendo concorrer com a reconciliação de tópicos e do grafo do mesmo usuário.

## Requisitos

- **REQ-1**: `store_content_embedding` DEVE adquirir o mesmo lease Redis do índice do Brain antes de abrir uma conexão de banco ou atualizar um `BrainNode`.
- **REQ-2**: Quando o lease estiver ocupado ou Redis não estiver disponível, a função DEVE retornar `false` sem tocar o banco.
- **REQ-3**: Enquanto o embedding é persistido, a função DEVE manter heartbeat do lease e confirmar ownership antes da mutação.
- **REQ-4**: Se o lease for perdido localmente antes da escrita, a função DEVE retornar `false` sem executar `UPDATE`.
- **REQ-5**: O lease DEVE ser liberado ao final, inclusive quando a atualização não encontra o nó.

## Fora de escopo

- Introduzir fencing token atômico no banco.
- Alterar o formato, modelo ou geração de embeddings.
- Reindexar conteúdo existente ou alterar a estratégia de busca híbrida.

## Critérios de aceite

- Embeddings não concorrem com outro passe de materialização do Brain do mesmo usuário.
- Lease ocupado, Redis indisponível e perda local não produzem mutação no banco.
- Escrita válida continua atualizando somente o `BrainNode` do usuário e conteúdo informados.
- Há teste do worker para os caminhos de sucesso, lease indisponível e perda de ownership, e os checks Python relevantes permanecem verdes.
