"""Extração estruturada grounded para o Brain (spec 104 / ADR-011).

Padrão LangExtract: cada entidade/claim carrega um `excerpt` literal do texto.
Sem a lib langextract — OpenRouter + JSON, como o resto do worker.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx

from . import openrouter

OR_BASE_URL = openrouter.OR_BASE_URL
MAX_ENTITIES = 8
MAX_CLAIMS = 6
MAX_TEXT = 6_000


@dataclass(frozen=True)
class GroundedItem:
    kind: str  # entity | claim
    label: str
    excerpt: str
    confidence: float


@dataclass(frozen=True)
class GroundedExtractionResult:
    items: list[GroundedItem]
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


def normalize_for_grounding(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = text.casefold()
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_grounded(excerpt: str, source_text: str) -> bool:
    """Excerpt deve aparecer no texto-fonte (após normalização)."""
    ex = normalize_for_grounding(excerpt)
    src = normalize_for_grounding(source_text)
    if len(ex) < 8 or len(src) < 8:
        return False
    return ex in src


def slugify_label(label: str) -> str:
    nfkd = unicodedata.normalize("NFD", label or "")
    no_accents = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", "-", no_accents.lower())
    return slug.strip("-")[:80]


def parse_grounded_payload(raw: str, source_text: str) -> list[GroundedItem]:
    """Parse JSON do modelo e filtra só itens groundable."""
    text = (raw or "").strip()
    if not text:
        return []
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.I)
    payload_src = fence.group(1) if fence else text
    obj_match = re.search(r"\{[\s\S]*\}", payload_src)
    if not obj_match:
        return []
    try:
        parsed = json.loads(obj_match.group(0))
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, dict):
        return []

    out: list[GroundedItem] = []
    seen: set[str] = set()

    def add(kind: str, label: object, excerpt: object, confidence: object = 0.7) -> None:
        if not isinstance(label, str) or not isinstance(excerpt, str):
            return
        lab = " ".join(label.split()).strip()
        exc = " ".join(excerpt.split()).strip()
        if len(lab) < 2 or len(exc) < 8:
            return
        if not is_grounded(exc, source_text):
            return
        slug = slugify_label(lab)
        if not slug or slug in seen:
            return
        conf = 0.7
        if isinstance(confidence, (int, float)):
            conf = max(0.4, min(0.95, float(confidence)))
        seen.add(slug)
        out.append(GroundedItem(kind=kind, label=lab[:80], excerpt=exc[:400], confidence=conf))

    entities = parsed.get("entities")
    if isinstance(entities, list):
        for item in entities[: MAX_ENTITIES * 2]:
            if not isinstance(item, dict):
                continue
            add(
                "entity",
                item.get("label") or item.get("name"),
                item.get("excerpt") or item.get("evidence"),
                item.get("confidence", 0.75),
            )
            if sum(1 for x in out if x.kind == "entity") >= MAX_ENTITIES:
                break

    claims = parsed.get("claims")
    if isinstance(claims, list):
        for item in claims[: MAX_CLAIMS * 2]:
            if not isinstance(item, dict):
                continue
            add(
                "claim",
                item.get("label") or item.get("claim") or item.get("text"),
                item.get("excerpt") or item.get("evidence"),
                item.get("confidence", 0.7),
            )
            if sum(1 for x in out if x.kind == "claim") >= MAX_CLAIMS:
                break

    return out


async def extract_grounded_concepts(
    *,
    title: str,
    content: str,
    api_key: str,
    model: str,
    language: str = "pt-BR",
    client: httpx.AsyncClient | None = None,
) -> GroundedExtractionResult:
    """Chama OpenRouter e devolve só itens com excerpt groundable."""
    body = (content or "").strip().replace("\x00", " ")[:MAX_TEXT]
    source_for_ground = f"{title}\n{body}"
    if language == "en":
        system = (
            "Extract structured knowledge for a personal KB. Reply ONLY with JSON:\n"
            '{"entities":[{"label":"...","excerpt":"verbatim quote from the text",'
            '"confidence":0.0-1.0}],'
            '"claims":[{"label":"short factual claim","excerpt":"verbatim quote",'
            '"confidence":0.0-1.0}]}\n'
            "excerpt MUST be a contiguous substring of the content. Max 8 entities, 6 claims. "
            "Prefer proper names, tools, products. No invented quotes."
        )
        user = f"Title: {title.strip() or '(none)'}\n\nContent:\n{body}"
    else:
        system = (
            "Extraia conhecimento estruturado para uma base pessoal. Responda SÓ JSON:\n"
            '{"entities":[{"label":"...","excerpt":"trecho literal do texto",'
            '"confidence":0.0-1.0}],'
            '"claims":[{"label":"afirmação curta","excerpt":"trecho literal",'
            '"confidence":0.0-1.0}]}\n'
            "excerpt DEVE ser substring contígua do conteúdo. Máx. 8 entidades, 6 claims. "
            "Prefira nomes próprios, ferramentas, produtos. Sem citações inventadas."
        )
        user = f"Título: {title.strip() or '(sem título)'}\n\nConteúdo:\n{body}"

    payload: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Yefclub/Voxen",
        "X-Title": "Voxen Brain Extract",
    }

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=90.0)
    try:
        res = await http.post(f"{OR_BASE_URL}/chat/completions", headers=headers, json=payload)
        if res.status_code in (401, 403):
            raise openrouter.OpenrouterAuthError(
                f"OpenRouter rejeitou a chave (HTTP {res.status_code})."
            )
        if res.status_code >= 500:
            raise openrouter.OpenrouterTransientError(f"OpenRouter {res.status_code}")
        if not res.is_success:
            raise RuntimeError(
                f"OpenRouter retornou uma resposta inesperada (HTTP {res.status_code})."
            )
        data: dict[str, Any] = res.json()
    finally:
        if owns_client:
            await http.aclose()

    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    raw = message.get("content") or ""
    usage = data.get("usage") or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)
    cost = Decimal(str((data.get("usage") or {}).get("total_cost") or 0))
    if cost == 0 and tokens_in:
        # fallback grosso se a API não mandar total_cost
        cost = Decimal(tokens_in + tokens_out) * Decimal("0.000001")

    items = parse_grounded_payload(str(raw), source_for_ground)
    return GroundedExtractionResult(
        items=items,
        cost_usd=cost,
        model=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )
