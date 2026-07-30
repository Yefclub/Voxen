# Transcript Markdown Format — Voxen

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

`subtitles` means the source had official captions. `api` means audio was downloaded, segmented, and sent to OpenRouter transcription. `scrape` is used for web pages.

## Postgres Mirror

The `Transcript` table stores:

- `plainText`: searchable text without timestamps or frontmatter
- `searchVector`: generated `tsvector` for Postgres FTS
- `frontmatter`: JSON mirror of YAML metadata
- `mdPath`: object storage key

The chat agent searches the mirrored text, then reads the canonical Markdown file when it needs the full source.

## Versioning

Breaking changes must bump:

```yaml
transcript_format_version: 2
```

Migration jobs should preserve existing files and write upgraded versions deterministically.
