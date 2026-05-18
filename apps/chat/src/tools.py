"""Tools determinísticas escopadas por userId (spec 003)."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

import httpx
import structlog

from . import db, redis_pub, storage, voxen_settings

OR_BASE_URL = "https://openrouter.ai/api/v1"
_log = structlog.get_logger()
# Cap pra evitar query absurdamente longa explodindo tokens da OR
WEB_SEARCH_MAX_QUERY_CHARS = 1000

# Video URL parsers — espelham apps/web/src/lib/video-url.ts.
_YT_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com")
_YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_IG_HOSTS = ("instagram.com", "www.instagram.com", "m.instagram.com")
_IG_CODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_TT_HOSTS = ("tiktok.com", "www.tiktok.com", "m.tiktok.com")
_TT_SHORT_HOSTS = ("vm.tiktok.com", "vt.tiktok.com")
_TT_ID_RE = re.compile(r"^[0-9]{6,32}$")
_TT_SHORT_RE = re.compile(r"^[A-Za-z0-9_-]+$")

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
            "name": "scrape_url",
            "description": (
                "Baixa e indexa uma página web (blog, artigo, docs, wiki). "
                "Cria um Job que extrai o conteúdo principal via Trafilatura "
                "e salva como Transcript do tipo WEB. NÃO espera concluir — "
                "retorna o job_id. Use quando o usuário enviar um link de "
                "página web (não-YouTube). Avise que vai levar uns segundos."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL http(s) da página a indexar.",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "transcribe_video",
            "description": (
                "Dispara transcrição de um vídeo (YouTube, Instagram Reel ou "
                "TikTok). Recebe a URL e agenda um Job no worker. NÃO espera "
                "concluir — retorna o job_id pra acompanhar. Use quando o "
                "usuário pedir pra transcrever/baixar/indexar um link de "
                "vídeo. Avise que vai demorar (curto: ~30s, vídeos longos "
                "podem levar minutos)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": (
                            "URL do vídeo. Aceita YouTube (youtu.be, "
                            "youtube.com/watch, /shorts), Instagram "
                            "(instagram.com/reel|/p|/tv) e TikTok "
                            "(tiktok.com/@user/video, vm/vt.tiktok.com)."
                        ),
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
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Pesquisa na web ao vivo via OpenRouter (plugin :online). "
                "Use APENAS quando a base de conhecimento não tem a info, "
                "ou para confirmar dados atualizados (datas, números, fatos "
                "que mudam). NÃO use pra navegação genérica nem em vez de "
                "search_transcripts. Retorna texto sintetizado com fontes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Pergunta clara em português ou inglês.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_user_confirmation",
            "description": (
                "Solicita confirmação explícita do usuário ANTES de uma ação "
                "potencialmente destrutiva ou criativa (ex: excluir nota, "
                "criar nota com X texto, sobrescrever conteúdo). NÃO use pra "
                "ler, listar ou pesquisar — só pra ações que modificam dados. "
                "Após chamar, ESPERE a próxima mensagem do usuário; ele vai "
                "responder 'sim' ou 'não' textualmente. Não chame em loop."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action_summary": {
                        "type": "string",
                        "description": (
                            "Resumo curto e direto do que vai fazer "
                            "(ex: 'Criar nota \"Reunião 2026-05-18\" com 3 "
                            "parágrafos sobre X'). Em português."
                        ),
                    },
                },
                "required": ["action_summary"],
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

        if name == "scrape_url":
            url = str(args.get("url", "")).strip()
            normalized = _normalize_web_url(url)
            if not normalized:
                return {"error": "URL inválida. Informe um link http(s) válido."}
            res = await db.create_scrape_job(user_id, normalized)
            if res.get("duplicate") == "transcript":
                return {
                    "status": "already_indexed",
                    "transcript_id": res["transcript_id"],
                    "message": "Essa página já está na biblioteca.",
                }
            if res.get("duplicate") == "job":
                return {
                    "status": "already_queued",
                    "job_id": res["id"],
                    "message": "Essa página já está sendo indexada.",
                }
            await redis_pub.publish_new_job(res["id"])
            return {
                "status": "queued",
                "job_id": res["id"],
                "source_url": normalized,
                "message": (
                    "Página agendada. O worker vai baixar e extrair o "
                    "conteúdo — acompanhe em /jobs/" + res["id"] + "."
                ),
            }

        if name == "transcribe_video":
            url = str(args.get("url", "")).strip()
            canonical = _canonical_video_url(url)
            if not canonical:
                return {
                    "error": (
                        "URL não suportada. Aceito YouTube, Instagram (reel/p/tv) "
                        "e TikTok."
                    ),
                }
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

        if name == "web_search":
            query = str(args.get("query", "")).strip()
            if not query:
                return {"error": "Parâmetro 'query' vazio."}
            return await _web_search(user_id, query)

        if name == "request_user_confirmation":
            # HITL: o agente sinaliza que precisa de aprovação humana antes
            # de uma ação destrutiva/criativa. A UI detecta o nome dessa tool
            # via SSE tool_start e renderiza um banner próprio — o retorno aqui
            # é só metadado de instrução pro agente terminar a resposta.
            summary = str(args.get("action_summary", "")).strip()
            if not summary:
                return {"error": "action_summary vazio."}
            return {
                "status": "pending_user_response",
                "action_summary": summary,
                "instruction": (
                    "Você JÁ pediu confirmação ao usuário. Termine sua resposta "
                    "atual sem executar a ação. Aguarde a próxima mensagem dele."
                ),
            }

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


async def _web_search(user_id: str, query: str) -> dict[str, Any]:
    """Pesquisa na web via OpenRouter.

    Estratégia:
      1) Setting `default_web_search_model` configurada → usa esse modelo
         direto (deve ter `:online` ou suportar web nativamente).
      2) Senão, usa `default_chat_model + ":online"` (plugin Perplexity).
      3) Sem API key OR → erro claro.
    Custo é registrado em CostEvent kind=CHAT (somando ao painel do user).
    """
    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        return {"error": "OpenRouter sem configuração. Avise o admin."}

    model = await voxen_settings.get_default_web_search_model()
    if not model:
        base = await voxen_settings.get_default_chat_model()
        if not base:
            return {"error": "Modelo de chat não configurado."}
        # Sufixo `:online` ativa o plugin web da Perplexity em qualquer modelo
        model = base if base.endswith(":online") else f"{base}:online"

    # Cap query length antes de enviar ao OR (e ao registrar em CostEvent.meta)
    safe_query = query[:WEB_SEARCH_MAX_QUERY_CHARS]

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Você é um buscador. Responda à pergunta usando informação "
                    "atualizada da web. Cite fontes (URLs) entre parênteses. "
                    "Seja conciso (até 6 parágrafos curtos)."
                ),
            },
            {"role": "user", "content": safe_query},
        ],
        "stream": False,
        "usage": {"include": True},
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(
                f"{OR_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
    except httpx.HTTPError as e:
        return {"error": f"Falha ao contactar OpenRouter: {e}"}

    if res.status_code >= 400:
        # Não vazamos body do OR pro agente (pode conter info sensível);
        # log interno tem o detalhe.
        _log.warning("web-search-or-error", status=res.status_code, body=res.text[:300])
        return {"error": f"OpenRouter retornou {res.status_code}."}

    data = res.json()
    text = ((data.get("choices") or [{}])[0].get("message", {}).get("content") or "").strip()
    usage = data.get("usage") or {}
    cost_raw = usage.get("cost")
    try:
        cost_usd = Decimal(str(cost_raw)) if cost_raw is not None else Decimal("0")
    except (ValueError, ArithmeticError):
        cost_usd = Decimal("0")
    # Registra custo no painel — falha aqui não invalida a resposta da pesquisa
    try:
        await db.insert_cost_event(
            user_id=user_id,
            model=model,
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
            cost_usd=cost_usd,
            meta={"source": "web_search", "query": safe_query[:200]},
        )
    except Exception as e:  # noqa: BLE001
        _log.warning("web-search-cost-event-failed", error=str(e))

    return {"answer": text or "Sem resposta da pesquisa.", "model": model}


def _normalize_web_url(url: str) -> str | None:
    """Valida URL http(s) e remove fragments (#anchor não afeta conteúdo)."""
    from urllib.parse import urlparse, urlunparse

    try:
        u = urlparse(url.strip())
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.hostname:
        return None
    return urlunparse(u._replace(fragment=""))


def _canonical_video_url(url: str) -> str | None:
    """Parser unificado YouTube/Instagram/TikTok. Espelha video-url.ts.

    Retorna a URL canonical pra dedup consistente em todo o sistema.
    Devolve None se a URL não bate com nenhuma plataforma suportada.
    """
    from urllib.parse import parse_qs, urlparse

    try:
        u = urlparse(url.strip())
    except ValueError:
        return None
    if u.scheme not in ("http", "https"):
        return None
    host = (u.hostname or "").lower()
    if not host:
        return None

    # YouTube
    if host in _YT_HOSTS:
        video_id: str | None = None
        if host == "youtu.be":
            video_id = u.path.lstrip("/").split("/")[0] or None
        else:
            parts = [p for p in u.path.split("/") if p]
            if parts and parts[0] in ("shorts", "embed", "v") and len(parts) > 1:
                video_id = parts[1]
            else:
                v = parse_qs(u.query).get("v")
                if v:
                    video_id = v[0]
        if video_id and _YT_ID_RE.match(video_id):
            return f"https://youtu.be/{video_id}"
        return None

    # Instagram (/reel|reels|p|tv/CODE — aceita também /<user>/reel/CODE)
    if host in _IG_HOSTS:
        parts = [p for p in u.path.split("/") if p]
        reel_types = {"reel", "reels", "p", "tv"}
        for i in range(len(parts) - 1):
            if parts[i] in reel_types:
                code = parts[i + 1]
                if _IG_CODE_RE.match(code):
                    return f"https://www.instagram.com/reel/{code}/"
                return None
        return None

    # TikTok (/@user/video/ID)
    if host in _TT_HOSTS:
        parts = [p for p in u.path.split("/") if p]
        if (
            len(parts) >= 3
            and parts[0].startswith("@")
            and parts[1] == "video"
            and _TT_ID_RE.match(parts[2])
        ):
            return f"https://www.tiktok.com/{parts[0]}/video/{parts[2]}"
        if len(parts) >= 2 and parts[0] == "video" and _TT_ID_RE.match(parts[1]):
            return f"https://www.tiktok.com/video/{parts[1]}"
        return None

    # TikTok short links — preserve como vieram (worker resolve via yt-dlp)
    if host in _TT_SHORT_HOSTS:
        code = u.path.strip("/")
        if code and _TT_SHORT_RE.match(code):
            return f"https://{host}/{code}"
        return None

    return None


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
