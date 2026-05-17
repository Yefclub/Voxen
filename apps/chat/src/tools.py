"""5 tools determinísticas escopadas por userId (spec 003)."""

from __future__ import annotations

import re
from typing import Any

from . import db, storage

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
