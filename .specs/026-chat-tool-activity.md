# 026 — Atividade de tools no chat + referências da resposta

## Contexto

Hoje as execuções de tools aparecem no chat como chips minúsculos (nome da tool,
preview truncado no `title`). O usuário não vê o que foi pesquisado, quais links
a pesquisa web consultou, nem referências na resposta final — diferente de
plataformas modernas de IA (ChatGPT, Claude, Perplexity), que mostram a
atividade das ferramentas e citam fontes.

O backend já tem quase tudo: `_web_search` retorna `{answer, sources: [{url,
title}]}` (citações `url_citation` do OpenRouter), e o SSE emite
`tool_start`/`tool_end`. Mas o `tool_end` só carrega `preview` truncado, e a
persistência (`ChatMessage.tools`) guarda só `{name, preview}`.

## Requisitos (EARS)

### Backend — chat service (apps/chat/src/main.py)

- **Quando** uma tool completa, **o sistema deve** incluir no payload do
  `tool_end`, além de `name` e `preview`: `args` (argumentos da chamada,
  sanitizados/limitados) e, quando o resultado contiver `sources` (lista de
  `{url, title}`), o campo `sources`.
- **Enquanto** uma tool executa, **o sistema deve** continuar emitindo
  `tool_start` (já contém `args`) e `tool_progress` — sem mudança de contrato.
- **Se** o resultado da tool não tiver `sources`, **o sistema deve** omitir o
  campo (payload enxuto, compat com tools existentes).

### Backend — web (apps/web/src/routes/chat.ts)

- **Quando** o proxy SSE acumular tools para persistir em `ChatMessage.tools`,
  **o sistema deve** gravar `{name, args?, preview?, sources?}` — capturando
  `args` do `tool_start` e `sources` do `tool_end`.
- **Quando** mensagens forem listadas (GET), **o sistema deve** retornar o
  campo `tools` enriquecido sem quebra de compatibilidade com mensagens
  antigas (que só têm `{name, preview}`).

### Frontend — chat (apps/web/src/client/pages/chat.tsx)

- **Quando** uma mensagem do assistente tiver tools, **o sistema deve** exibir
  um card de atividade por tool, expansível, com: ícone por tipo de tool, nome
  humanizado (i18n), resumo do argumento principal (ex.: query da pesquisa,
  título/URL do vídeo) e estado (executando/concluída).
- **Enquanto** uma tool estiver executando (entre `tool_start` e `tool_end`),
  **o card deve** mostrar indicador de progresso.
- **Quando** a tool for `web_search` e houver `sources`, **o card expandido
  deve** listar os links consultados (título + domínio, clicáveis, abrindo em
  nova aba com `rel="noopener noreferrer"`).
- **Quando** a resposta final do assistente tiver pelo menos uma `web_search`
  com `sources`, **o sistema deve** renderizar uma seção "Fontes" ao final da
  mensagem com os links deduplicados e numerados.
- **Se** a mensagem for antiga (tools sem `args`/`sources`), **o sistema
  deve** renderizar o card básico (nome + preview) sem erro.

### Segurança

- URLs de `sources` **devem** ser renderizadas como links apenas quando
  http/https (sem `javascript:` etc.).
- `args` persistidos **devem** ser truncados (limite por campo) para não inflar
  o JSONB nem vazar payloads grandes.

## Não-objetivos

- Não mudar o formato de resposta das tools no agente (contrato OpenRouter).
- Não adicionar telemetria/analytics de tools.
- Não citar fontes inline no markdown da resposta (só a seção "Fontes" — o
  modelo já pode citar inline por conta própria).

## Critérios de aceite

1. Enviar mensagem que dispara `web_search` → card mostra a query, depois os
   links consultados; resposta final exibe seção "Fontes" com os links.
2. Tools sem sources (ex.: `read_transcript`) → card com nome humanizado e
   preview, sem seção de fontes.
3. Mensagens antigas continuam renderizando sem erro.
4. Recarregar a conversa → cards e fontes persistem (vêm do `ChatMessage.tools`).
5. pytest cobre a montagem do payload de `tool_end` (com e sem sources).
