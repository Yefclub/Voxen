"""Tools determinísticas escopadas por userId (spec 003)."""

from __future__ import annotations

import re
from typing import Any

from . import db, redis_pub, storage

# YouTube URL canonicalization — espelha apps/web/src/lib/youtube-url.ts.
_YT_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com")
_YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

_LINE_RE = re.compile(r"^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\(.*?\)\s*(.*)$")

# Definição OpenAI function-calling — passada ao modelo no campo `tools`.
TOOLS_SPEC: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_transcripts",
            "description": (
                "Lista as transcrições do usuário (mais recentes primeiro). "
                "Use para entender o que está disponível antes de buscar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Máximo de itens (padrão 30, máx 100).",
                    },
                    "source": {
                        "type": "string",
                        "enum": ["YOUTUBE", "INSTAGRAM", "TIKTOK"],
                        "description": "Filtrar por plataforma de origem.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_transcripts",
            "description": (
                "Busca full-text nas transcrições do usuário. Retorna trechos "
                "relevantes com pontuação de relevância. Use palavras-chave em "
                "português, sem operadores."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Termos de busca em português."},
                    "limit": {"type": "integer", "description": "Máx resultados (padrão 8)."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_transcript",
            "description": (
                "Lê a transcrição completa (markdown com timestamps) de uma transcrição. "
                "Use depois de identificar o id via list ou search."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "transcript_id": {"type": "string", "description": "ID da transcrição."},
                },
                "required": ["transcript_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_transcript_section",
            "description": (
                "Lê um recorte da transcrição entre dois timestamps em segundos. "
                "Útil quando search retornou um trecho e você precisa do contexto."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "transcript_id": {"type": "string"},
                    "from_sec": {"type": "integer", "description": "Início em segundos."},
                    "to_sec": {"type": "integer", "description": "Fim em segundos."},
                },
                "required": ["transcript_id", "from_sec", "to_sec"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_metadata",
            "description": "Metadata estruturada de uma transcrição (frontmatter JSON).",
            "parameters": {
                "type": "object",
                "properties": {
                    "transcript_id": {"type": "string"},
                },
                "required": ["transcript_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "transcribe_video",
            "description": (
                "Dispara a transcrição de um vídeo do YouTube. Recebe a URL e "
                "agenda um Job no worker. NÃO espera concluir — retorna o "
                "job_id pra acompanhar. Use quando o usuário pedir pra "
                "transcrever/baixar/indexar um link novo. Avise no texto que "
                "vai demorar (curto: ~30s, vídeos longos podem levar minutos)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL do vídeo no YouTube. Aceita youtu.be/ID, youtube.com/watch?v=ID e variações.",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_transcript_summary",
            "description": (
                "Lê o resumo em markdown da transcrição (gerado pela IA na ingestão). "
                "Mais barato e direto que `read_transcript`. Use quando o usuário "
                "pedir resumo/visão geral. Se retornar vazio/erro, caia pro read_transcript."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "transcript_id": {"type": "string", "description": "ID da transcrição."},
                },
                "required": ["transcript_id"],
            },
        },
    },
]


async def execute_tool(name: str, args: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Executa tool por nome. SEMPRE escopado por user_id (injetado pelo handler)."""
    try:
        if name == "list_transcripts":
            limit = min(int(args.get("limit", 30)), 100)
            source = args.get("source")
            rows = await db.list_user_transcripts(user_id, limit=limit, source=source)
            return {"transcripts": [_serialize(r) for r in rows]}

        if name == "search_transcripts":
            query = str(args.get("query", "")).strip()
            if not query:
                return {"error": "Parâmetro 'query' vazio."}
            limit = min(int(args.get("limit", 8)), 25)
            rows = await db.search_user_transcripts(user_id, query, limit=limit)
            return {
                "results": [
                    {
                        "id": r["id"],
                        "title": r["title"],
                        "snippet": r["snippet"],
                        "rank": float(r["rank"]),
                    }
                    for r in rows
                ]
            }

        if name == "read_transcript":
            tid = str(args.get("transcript_id", ""))
            t = await db.get_user_transcript(user_id, tid)
            if not t:
                return {"error": "Transcrição não encontrada."}
            md = await storage.get_markdown(t["mdPath"])
            return {"id": t["id"], "title": t["title"], "markdown": md}

        if name == "read_transcript_section":
            tid = str(args.get("transcript_id", ""))
            from_sec = int(args.get("from_sec", 0))
            to_sec = int(args.get("to_sec", from_sec + 60))
            t = await db.get_user_transcript(user_id, tid)
            if not t:
                return {"error": "Transcrição não encontrada."}
            md = await storage.get_markdown(t["mdPath"])
            section = _extract_section(md, from_sec, to_sec)
            return {
                "id": t["id"],
                "title": t["title"],
                "from_sec": from_sec,
                "to_sec": to_sec,
                "markdown": section,
            }

        if name == "get_metadata":
            tid = str(args.get("transcript_id", ""))
            t = await db.get_user_transcript(user_id, tid)
            if not t:
                return {"error": "Transcrição não encontrada."}
            return {"id": t["id"], "metadata": t.get("frontmatter") or {}}

        if name == "transcribe_video":
            url = str(args.get("url", "")).strip()
            if not url:
                return {"error": "URL ausente."}
            canonical = _canonical_youtube_url(url)
            if not canonical:
                return {"error": "URL não suportada. Use um link válido do YouTube."}
            res = await db.create_transcribe_job(user_id, canonical)
            if res.get("duplicate") == "transcript":
                return {
                    "status": "already_transcribed",
                    "transcript_id": res["transcript_id"],
                    "message": "Esse vídeo já está na biblioteca.",
                }
            if res.get("duplicate") == "job":
                return {
                    "status": "already_queued",
                    "job_id": res["id"],
                    "job_status": res["status"],
                    "message": "Esse vídeo já está em processamento.",
                }
            await redis_pub.publish_new_job(res["id"])
            return {
                "status": "queued",
                "job_id": res["id"],
                "source_url": canonical,
                "message": (
                    "Job criado. Worker vai baixar áudio e transcrever — "
                    "acompanhe em /jobs/" + res["id"] + "."
                ),
            }

        if name == "read_transcript_summary":
            tid = str(args.get("transcript_id", ""))
            t = await db.get_user_transcript(user_id, tid)
            if not t:
                return {"error": "Transcrição não encontrada."}
            summary = t.get("summaryMd")
            if not summary:
                return {
                    "id": t["id"],
                    "summary": None,
                    "hint": "Resumo ainda não gerado — use read_transcript.",
                }
            return {"id": t["id"], "title": t["title"], "summary": summary}

        return {"error": f"Tool desconhecida: {name}"}
    except Exception as e:  # noqa: BLE001 — agente decide como reagir
        return {"error": f"Falha ao executar {name}: {e}"}


def _serialize(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "channel": row.get("channel"),
        "durationSec": row["durationSec"],
        "source": row["source"],
        "createdAt": row["createdAt"].isoformat() if row.get("createdAt") else None,
    }


def _canonical_youtube_url(url: str) -> str | None:
    """Extrai videoId e devolve forma canônica `https://youtu.be/<id>`.

    Aceita: youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /embed/ID, /v/ID,
    com ou sem `www.`/`m.`/`music.`. Retorna None se inválido.
    """
    from urllib.parse import parse_qs, urlparse

    try:
        u = urlparse(url.strip())
    except ValueError:
        return None
    if not u.scheme or u.scheme not in ("http", "https"):
        return None
    host = (u.hostname or "").lower()
    if host not in _YT_HOSTS:
        return None

    video_id: str | None = None
    if host == "youtu.be":
        video_id = u.path.lstrip("/").split("/")[0] or None
    else:
        path_parts = [p for p in u.path.split("/") if p]
        if path_parts and path_parts[0] in ("shorts", "embed", "v") and len(path_parts) > 1:
            video_id = path_parts[1]
        else:
            qs = parse_qs(u.query)
            v = qs.get("v")
            if v:
                video_id = v[0]
    if not video_id or not _YT_ID_RE.match(video_id):
        return None
    return f"https://youtu.be/{video_id}"


def _extract_section(md: str, from_sec: int, to_sec: int) -> str:
    """Filtra linhas do .md cujo timestamp cai no intervalo."""
    out: list[str] = []
    for line in md.split("\n"):
        m = _LINE_RE.match(line)
        if not m:
            continue
        h_or_m, m2, s, text = m.groups()
        if s is None:
            secs = int(h_or_m) * 60 + int(m2)
        else:
            secs = int(h_or_m) * 3600 + int(m2) * 60 + int(s)
        if from_sec <= secs <= to_sec:
            out.append(f"[{h_or_m}:{m2}{f':{s}' if s else ''}] {text.strip()}")
    return "\n".join(out)
