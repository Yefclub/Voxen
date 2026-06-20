# 027 — Tool render v2: cards ricos e fontes com favicon

## Contexto

A spec 026 introduziu cards de atividade de tools e a seção "Fontes", mas o
corpo expandido do card ainda mostra o `preview` cru (JSON truncado) — feio e
pouco informativo. O owner pediu o padrão do Orbital (produto de referência):
query da pesquisa em chip de busca, lista de fontes com favicon + domínio, e
nada de JSON cru para tools conhecidas.

## Requisitos (EARS)

### Backend — chat service

- **Quando** uma tool completa, **o sistema deve** incluir no payload do
  `tool_end` um campo `summary`: resumo humano curto do resultado (PT-BR),
  derivado por tipo de tool:
  - erro → a mensagem de erro;
  - `web_search` → "N fontes consultadas";
  - resultados de busca/listagem → "N resultados/transcrições/notas/caminhos";
  - leitura/transcrição/nota → título do item.
- **Se** o resultado não casar com nenhuma heurística, **o sistema deve**
  omitir `summary` (frontend cai no fallback).

### Backend — web

- **Quando** persistir tools em `ChatMessage.tools`, **o sistema deve** gravar
  também `summary` (truncado a 200 chars).

### Frontend — card de tool

- **Quando** a tool for `web_search` e houver `sources`, **o corpo expandido
  deve** mostrar: a query num chip estilo barra de busca + a lista de fontes
  com favicon (DuckDuckGo `icons.duckduckgo.com/ip3/<domínio>.ico`, fallback
  pra ícone de globo), título e domínio — links em nova aba.
- **Quando** houver `summary` (qualquer tool), **o corpo deve** mostrar o
  resumo humano em texto — **nunca** o JSON cru.
- **Se** não houver `summary` nem `sources` (mensagens antigas), **o sistema
  deve** cair no `preview` como último recurso.
- **Quando** derivar o domínio de uma fonte, **o sistema deve** preferir o
  `title` quando ele tiver cara de domínio (citações do OpenRouter vêm com
  URL de redirect `vertexaisearch...` e o domínio real no título); senão usa o
  hostname da URL.

### Frontend — seção Fontes

- **Quando** renderizar a seção "Fontes", **cada chip deve** exibir favicon +
  número + domínio/título, sem o hostname de redirect.

## Não-objetivos

- Citações inline no markdown da resposta (pills no meio do texto) — fica pra
  iteração futura.
- Proxy próprio de favicons (usa DuckDuckGo direto; sem CSP no app).

## Critérios de aceite

1. Pesquisa web nova → card expandido mostra query + fontes com favicon; sem
   JSON cru.
2. Tools de leitura/busca → corpo mostra resumo humano ("3 resultados",
   título do vídeo etc.).
3. Mensagens antigas (só preview) continuam renderizando (fallback).
4. Seção Fontes com favicons e domínios limpos.
5. pytest cobre `_tool_summary` (erro, contagens, título, fallback None).
