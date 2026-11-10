# Transcript Markdown Format — Voxen

Documents arrive in two ways: prepared content through versioned HTTP/MCP contracts, and Voxen's own link and file capture (spec 220). This document describes the canonical format for both.

Each processed source becomes a Markdown file with YAML frontmatter, a readable header, and transcript content.

## Location

Canonical file:

```text
s3://voxen-transcripts/workspaces/<userId>/transcripts/<transcriptId>.md
```

Postgres mirrors plain text and structured metadata for fast search and filtering.

## Frontmatter

```yaml
---
id: 01J0K1A2B3C4D5E6F7G8H9J0K1
workspace_id: <userId>
source: youtube | instagram | tiktok | web
url: https://youtu.be/abc123
video_id: dQw4w9WgXcQ
title: How to configure Postgres FTS
channel: Example Channel
author: author name
duration_sec: 738
published_at: 2026-04-20T15:30:00Z
thumbnail: https://i.ytimg.com/vi/abc123/maxresdefault.jpg
language: en
model: x-ai/grok-stt-1.0
transcription_method: api | subtitles | scrape
transcribed_at: 2026-05-15T20:42:11Z
cost_usd: 0.0042
checksum: sha256:abc123...
transcript_format_version: 1
---
```

Required fields:

- `id`
- `workspace_id`
- `source`
- `url`
- `title`
- `duration_sec`
- `language`
- `transcription_method`
- `transcribed_at`

### Captured documents (spec 220)

Capture writes the same schema with these specifics:

- `source` also accepts `x` and `upload`.
- `transcription_method`: `subtitles` (platform captions), `scrape` (post,
  page, or description text), `api` (speech-to-text through the user's
  provider), `vision` (image descriptions), or `document` (uploaded file).
- `model`: the interpretation model in the chosen provider's format (for
  example `anthropic/claude-haiku-4-5`).
- `cost_usd`: estimated capture cost (STT + vision + interpretation) when the
  catalog has a price; `null` when there is no estimate.
- `video_id`: the platform id when one exists (YouTube, TikTok, Instagram, X
  status); omitted for web pages and uploads.
- `producer: voxen-capture` marks documents produced by capture.

Null fields are omitted except `cost_usd`. A captured body contains, in order:
an optional thumbnail, the title, a quote line with an "Original" link,
channel, duration, and publication date, `## Resumo`, `## Pontos-chave`, `## Imagens`
(image descriptions, when present), and then `## Transcrição` (timestamped
lines as below) or `## Conteúdo` (page or post text). Summary, key points, and
image descriptions come from the model and are stripped of links, images,
URLs, and HTML; captured text never auto-loads remote images or raw HTML.

Optional fields:

- `channel`
- `author`
- `published_at`
- `thumbnail`
- `model`
- `cost_usd`
- `checksum`

## Body Format

```markdown
![thumbnail](https://i.ytimg.com/vi/abc123/maxresdefault.jpg)

# How to configure Postgres FTS

> [Original video](https://youtu.be/abc123) - Example Channel - 12m18s

## Transcript

[00:00:00](https://youtu.be/abc123?t=0) Today we are going to talk about Postgres full-text search.

[00:00:15](https://youtu.be/abc123?t=15) First, it is important to understand why FTS is different from a simple ILIKE.
```

## Timestamp Rules

- Display format is always `hh:mm:ss`.
- YouTube timestamps use `?t=<seconds>` when possible.
- Instagram and TikTok do not have reliable timestamp deep links, so the original URL is used.
- Segments should represent natural speech chunks, usually around 10 to 30 seconds.

## Transcription Methods

`subtitles` means the source had official captions. `api` means speech-to-text: historically through OpenRouter, and since spec 220 through the STT provider the user configured, only when no usable text exists. `scrape` is used for web pages and post or description text. `vision` marks content described from images, and `document` marks uploaded documents.

## Postgres Mirror

The `Transcript` table stores:

- `plainText`: searchable text without timestamps or frontmatter
- `searchVector`: generated `tsvector` for Postgres FTS
- `frontmatter`: JSON mirror of YAML metadata
- `mdPath`: provider-neutral storage key (local volume or S3)

MCP clients search the mirrored text, then read the canonical Markdown file when they need the full source.

## Versioning

Breaking changes must bump:

```yaml
transcript_format_version: 2
```

Migration jobs should preserve existing files and write upgraded versions deterministically.
