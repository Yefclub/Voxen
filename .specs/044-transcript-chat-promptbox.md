# 044 — Composer rico no chat de transcrição (reuso do PromptBox)

## Contexto

O chat flutuante dentro de uma transcrição (`FloatingTranscriptChat` em
`apps/web/src/client/pages/transcricoes-detalhe.tsx`) usava um `<input>` de uma
linha — sem auto-resize, sem Shift+Enter, sem ditado por voz, sem anexos. O chat
principal já tem o composer `PromptBox` (`components/ui/prompt-box.tsx`) com todos
esses recursos.

Pesquisa de mercado (ChatGPT/Claude): o padrão para composer de chat é `<textarea>`
com auto-resize + Enter envia / Shift+Enter quebra linha — **não** um editor rico
(tiptap/lexical), que se justifica para o editor de NOTAS, não para o chat. Decisão
do owner: reusar o `PromptBox` completo no painel da transcrição.

## Requisitos (EARS)

- **R1** — Enquanto o painel de chat da transcrição estiver aberto, o sistema DEVE
  exibir o composer `PromptBox` no lugar do `<input>` de uma linha.
- **R2** — Quando o usuário digitar múltiplas linhas, o composer DEVE crescer em
  altura (auto-resize) até o teto e então rolar internamente.
- **R3** — Quando o usuário pressionar Enter sem Shift, o sistema DEVE enviar a
  mensagem; com Shift+Enter DEVE inserir quebra de linha.
- **R4** — Quando houver modelo de visão configurado (`/api/capabilities`), o
  sistema DEVE permitir anexar imagem e incluí-la (`image_data_url`) no envio.
- **R5** — Quando houver modelo de documentos configurado, o sistema DEVE permitir
  upload de documento pelo composer (mesmo fluxo do chat principal).
- **R6** — O sistema DEVE permitir ditado por voz (mic → `/api/chat/voice`) e o
  toggle de raciocínio (thinking), persistindo o thinking por conversa.
- **R7** — Quando o usuário usar @menção, o sistema DEVE permitir referenciar
  outras transcrições/notas, somadas à transcrição atual (sempre incluída no
  contexto do painel).
- **R8** — Os atalhos rápidos (resumo/ações/citações) DEVEM preencher o composer e
  focar, mantendo o comportamento atual.

## Não-objetivos

- Não introduzir tiptap/lexical (fica reservado para o futuro editor de notas).
- Não alterar o backend de `/send` (já aceita `image_data_url` e `mentions`).
- Não mudar o layout/altura do painel flutuante (spec 041 cobre isso).

## Critérios de aceite

- `tsc` + eslint + prettier verdes em `apps/web`.
- Verificação visual (Playwright): composer cresce, Enter/Shift+Enter, mic, anexo,
  thinking e @menção funcionam dentro do painel.
- Sem regressão na continuidade da conversa (resume) nem nos atalhos rápidos.
