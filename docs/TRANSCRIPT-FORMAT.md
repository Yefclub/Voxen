# Formato do `.md` de transcrição — Voxen

Cada vídeo transcrito vira um arquivo Markdown com:

1. **Frontmatter YAML** com metadata
2. **Cabeçalho** com thumbnail e link original
3. **Corpo** com transcrição segmentada em linhas com timestamps clicáveis

## Localização

- **Arquivo canônico**: `s3://voxen-transcripts/workspaces/<userId>/transcripts/<transcriptId>.md`
- **Texto puro + frontmatter espelhado** em Postgres `Transcript` table — base do Postgres FTS pra busca rápida
- Quando user acessa `/transcricao/:id` → o web busca o `.md` pelo driver de storage selecionado e renderiza com `react-markdown` ou similar

## Schema do frontmatter

```yaml
---
id: 01J0K1A2B3C4D5E6F7G8H9J0K1 # cuid gerado pelo worker
workspace_id: <userId>
source: youtube | instagram | tiktok | web # web = página HTML via Trafilatura (spec 004)
url: https://youtu.be/abc123 # URL canônica (parseVideoUrl em web, detect_source em worker)
video_id: dQw4w9WgXcQ # ver "Semântica do video_id" abaixo
title: Como configurar Postgres FTS
channel: Canal do Dev # YouTube channel, site name pra WEB, ou null
author: nome do autor # se aplicável
duration_sec: 738 # 12m18s — para WEB é sempre 0
published_at: 2026-04-20T15:30:00Z # se disponível
thumbnail: https://i.ytimg.com/vi/abc123/maxresdefault.jpg # OpenGraph image pra WEB
language: pt # ISO 639-1
model: x-ai/grok-stt-1.0 # null se source=web ou method=subtitles
transcription_method: api | subtitles | scrape # api=OpenRouter audio; subtitles=legendas oficiais; scrape=Trafilatura HTML
transcribed_at: 2026-05-15T20:42:11Z
cost_usd: 0.0042 # custo (0 para web/subtitles)
checksum: sha256:abc123... # do arquivo de áudio original (omitido para web)
---
```

### Semântica do `video_id` por source

O campo `video_id` muda de **formato e significado** conforme a plataforma:

| source      | formato                  | exemplo               | extraído de                                    |
| ----------- | ------------------------ | --------------------- | ---------------------------------------------- |
| `youtube`   | 11 chars `[A-Za-z0-9_-]` | `dQw4w9WgXcQ`         | canonical `youtu.be/<id>`                      |
| `instagram` | shortcode variável       | `Abc123_XYZ`          | `instagram.com/reel/<code>/`                   |
| `tiktok`    | numeric 6-32 chars       | `7123456789012345678` | `tiktok.com/@user/video/<id>`                  |
| `web`       | (campo vazio ou ausente) | `""`                  | sem ID semântico — usa hash da URL se precisar |

Use o `source` como **discriminador** antes de fazer parsing/dedup pelo `video_id`. Para cross-source uniqueness, prefira o `url` (que já vem canonical).

### Campos obrigatórios

- `id`, `workspace_id`, `source`, `url`, `title`, `duration_sec`, `language`, `transcription_method`, `transcribed_at`

### Campos opcionais

- `channel`, `author`, `published_at`, `thumbnail`, `model` (NA se `transcription_method=subtitles`), `cost_usd`, `checksum`

## Schema do corpo

```markdown
![thumbnail](https://i.ytimg.com/vi/abc123/maxresdefault.jpg)

# Como configurar Postgres FTS

> 🎬 [Vídeo original](https://youtu.be/abc123) — Canal do Dev — 12m18s — publicado em 20/04/2026

## Transcrição

[00:00:00](https://youtu.be/abc123?t=0) Olá pessoal, hoje a gente vai falar sobre Postgres Full Text Search.

[00:00:15](https://youtu.be/abc123?t=15) Antes de tudo, é importante entender por que FTS é diferente de um simples ILIKE.

[00:00:42](https://youtu.be/abc123?t=42) Vou abrir aqui o psql e mostrar a diferença na prática.

...
```

## Regras de geração

### Timestamps

- Formato display: `[hh:mm:ss]` (sempre 8 chars, com zeros à esquerda — facilita parsing por regex)
- Para vídeos < 1 hora, ainda usar `hh:mm:ss` (ex: `[00:05:23]`)
- Link: depende da plataforma
  - **YouTube**: `https://youtu.be/<id>?t=<segundos>` (formato curto suporta `?t=` em segundos)
  - **YouTube longo**: `https://www.youtube.com/watch?v=<id>&t=<segundos>s`
  - **Instagram**: SEM deep link de timestamp confiável — usar URL original sem `t=`
  - **TikTok**: SEM deep link de timestamp — URL original

### Segmentação

- Cada "linha" representa um chunk lógico (~10-30s de fala)
- Quebra natural por silêncio (vinda do modelo remoto) ou tempo máximo (30s)
- Texto da linha é o conteúdo falado nesse intervalo
- Mantém pontuação retornada pelo modelo remoto (Grok STT pontua em PT-BR)

### Quando vem de legendas oficiais (`transcription_method=subtitles`)

- o extrator de mídia baixa `.vtt`
- Parser converte VTT → linhas timestamped no formato do Voxen
- Frontmatter: `transcription_method: subtitles`, `model: <plataforma> auto-generated` ou `<plataforma> manual` se for closed caption manual
- `cost_usd` não se aplica (omitir ou 0)

### Quando vem de transcrição via API (`transcription_method=api`)

- o extrator de mídia baixa áudio
- ffmpeg segmenta em chunks (~5min com overlap 5s pra não cortar palavras)
- Cada chunk vai pra OpenRouter `/audio/transcriptions` com `response_format=verbose_json` (retorna segments com timestamps)
- Worker concatena segments, ajusta offsets por chunk, deduplica regiões de overlap
- Frontmatter: `transcription_method: api`, `model: x-ai/grok-stt-1.0`
- `cost_usd` somado dos chunks

## Renderização no front

Componente React `<TranscriptViewer markdown={mdContent} />`:

1. Parse frontmatter (lib `gray-matter` ou similar)
2. Renderiza markdown com `react-markdown` + plugins:
   - `remark-gfm` (tabelas, etc.)
   - Plugin custom pra transformar `[hh:mm:ss](url?t=N)` em botões `<TimestampButton>` que:
     - Ao clicar, mostra player embedded (YouTube IFrame API) na URL no timestamp
     - OU abre numa aba nova (config do user)
3. Frontmatter renderiza acima do corpo: thumbnail, título, link, autor, duração

## FTS — espelho no Postgres

Na tabela `Transcript`:

- `plainText: TEXT` — apenas o conteúdo falado (sem timestamps, sem frontmatter), concatenado com espaços
- `searchVector: tsvector` (GIN index) — gerado por trigger SQL a partir de `plainText` com dicionário `portuguese`
- `frontmatter: JSONB` — espelho do YAML pra queries estruturadas (filtros por source, language, etc.)
- `mdPath: TEXT` — chave relativa e independente do driver (ex: `workspaces/abc/transcripts/01J....md`)

Tool `search_transcripts(workspace_id, query)`:

```sql
SELECT
  t.id, t.title, t.url, t.thumbnail,
  ts_headline('portuguese', t.plain_text, plainto_tsquery('portuguese', $1),
              'StartSel=<mark>,StopSel=</mark>,MaxFragments=3,MinWords=15,MaxWords=30') AS snippet,
  ts_rank(t.search_vector, plainto_tsquery('portuguese', $1)) AS rank
FROM "Transcript" t
WHERE t.workspace_id = $2
  AND t.search_vector @@ plainto_tsquery('portuguese', $1)
ORDER BY rank DESC
LIMIT 10;
```

Retorna snippets com `<mark>` highlights — o agente integrado usa esses trechos
para decidir se precisa ler a transcrição completa.

## Versionamento do formato

Este documento é v1 do formato. Mudanças breaking → bump `transcript_format_version` no frontmatter:

```yaml
transcript_format_version: 1
```

Migração de v1 → v2 (futuro) acontece em job batch que processa todos os `.md` existentes.

## Exemplo completo

```markdown
---
id: 01J0K1A2B3C4D5E6F7G8H9J0K1
workspace_id: clxyz123abc
source: youtube
url: https://youtu.be/dQw4w9WgXcQ
title: "Rick Astley - Never Gonna Give You Up"
channel: Rick Astley
duration_sec: 213
published_at: 2009-10-25T06:57:33Z
thumbnail: https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg
language: en
model: x-ai/grok-stt-1.0
transcription_method: api
transcribed_at: 2026-05-15T20:42:11Z
cost_usd: 0.0018
transcript_format_version: 1
---

![thumbnail](https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg)

# Rick Astley - Never Gonna Give You Up

> 🎬 [Vídeo original](https://youtu.be/dQw4w9WgXcQ) — Rick Astley — 3m33s — publicado em 25/10/2009

## Transcrição

[00:00:43](https://youtu.be/dQw4w9WgXcQ?t=43) We're no strangers to love.

[00:00:48](https://youtu.be/dQw4w9WgXcQ?t=48) You know the rules and so do I.

[00:00:52](https://youtu.be/dQw4w9WgXcQ?t=52) A full commitment's what I'm thinking of.

[00:00:57](https://youtu.be/dQw4w9WgXcQ?t=57) You wouldn't get this from any other guy.

...
```
