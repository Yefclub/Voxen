# 032 — Conteúdo completo das tools renderizado em Markdown

## Contexto

O corpo do card de atividade mostrava resumos truncados com reticências
("…") — feedback do owner: "nada elegante, deve ter o conteúdo completo e como
algumas coisas são markdown, devemos renderizar, esses blocos podem ter barra
de rolagem para não ficar gigantes".

## Requisitos (EARS)

- **Quando** uma tool completar com um campo textual conhecido (`answer`,
  `markdown`, `summary`, `content`, `text`), **o sistema deve** incluir no
  `tool_end` o campo `content` com o texto COMPLETO (cap de 20.000 chars —
  proteção contra transcrições gigantes, sem reticências).
- **Quando** persistir tools em `ChatMessage.tools`, **o sistema deve** gravar
  `content` com o mesmo cap.
- **Quando** o card expandir e houver `content`, **a UI deve** renderizá-lo
  como **Markdown** num bloco com `max-height` e scroll interno.
- **Se** não houver `content`, **a UI deve** cair em `summary` (uma linha) e,
  por último, no preview legado — agora sem "…" anexado.
- **Enquanto** houver `summary`, **o header do card deve** continuar
  mostrando-o como linha curta (o `content` é só do corpo expandido).

## Não-objetivos

- Streaming do content (chega completo no tool_end).
- Renderizar markdown dentro do preview legado (dados truncados na origem).

## Critérios de aceite

1. web_search → corpo expandido mostra a resposta completa renderizada
   (títulos, listas, negrito), rolável, sem "…".
2. read_transcript/read_transcript_summary → markdown completo (capado em
   20k) rolável.
3. Tools sem campo textual (get_metadata) → comportamento atual (summary).
4. pytest cobre: content completo, cap, ausência.
