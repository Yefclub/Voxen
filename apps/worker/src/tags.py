"""Tags de conteúdo (spec 075) — helpers puros + geração no worker (auto-ingest).

Espelha `apps/web/src/lib/tags-generate.ts` para o pipeline ARQ: após
transcrição/scrape, a IA gera tags e o worker persiste Tag + TranscriptTag.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import httpx

MAX_TAGS = 5

TAG_BAD_MARKERS = (
    "the content",
    "this content",
    "looking at",
    "its about",
    "it's about",
    "it is about",
    "the user",
    "i want",
    "i will",
    "i need",
    "let me",
    "here are",
    "here is",
    "the tags",
    "as tags",
    "tags total",
    "json array only",
    "return json only",
    "no duplicates",
    "no sentences",
    "o conteúdo",
    "este conteúdo",
)

TAG_STOP_LABELS = {
    "content",
    "conteúdo",
    "conteudo",
    "misc",
    "other",
    "others",
    "outros",
    "geral",
    "general",
    "various",
    "stuff",
    "video",
    "vídeo",
    "tag",
    "tags",
    "none",
    "nenhuma",
    "n/a",
    "na",
    "null",
    "i see",
}


@dataclass(frozen=True)
class TagsGenerationResult:
    tags: list[str]
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


def slugify_tag(name: str) -> str:
    nfkd = unicodedata.normalize("NFD", name or "")
    no_accents = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", "-", no_accents.lower())
    return slug.strip("-")[:60]


def _clean_tag_name(raw: str) -> str | None:
    name = (raw or "").replace("\n", " ")
    name = re.sub(r"[#*`]", "", name)
    name = re.sub(r"""["'“”‘’]""", "", name)
    name = " ".join(name.split()).strip()
    name = re.sub(r"^[\s.,:;\-–—]+|[\s.,:;\-–—]+$", "", name)
    if not name:
        return None
    lower = name.lower()
    # Substring: raciocínio do modelo costuma prefixar ("Looking at the content").
    if any(m in lower for m in TAG_BAD_MARKERS):
        return None
    words = name.split()
    if len(words) > 4:
        return None
    if len(name) > 40:
        name = re.sub(r"\s+\S*$", "", name[:40]) or name[:40]
        name = re.sub(r"^[\s.,:;\-–—]+|[\s.,:;\-–—]+$", "", name).strip()
    if len(name) < 2:
        return None
    if name.casefold() in TAG_STOP_LABELS:
        return None
    if not slugify_tag(name):
        return None
    return name


def _extract_candidates(raw: str) -> list[str]:
    text = (raw or "").strip()
    if not text:
        return []

    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.I)
    json_source = fence.group(1) if fence else text
    arr_match = re.search(r"\[[\s\S]*\]", json_source)
    obj_match = re.search(r"\{[\s\S]*\}", json_source)
    candidates = (
        arr_match.group(0) if arr_match else None,
        obj_match.group(0) if obj_match else None,
    )
    for candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, list):
            return [v for v in parsed if isinstance(v, str)]
        if isinstance(parsed, dict):
            for key in ("tags", "labels", "tag", "categories"):
                val = parsed.get(key)
                if isinstance(val, list):
                    return [v for v in val if isinstance(v, str)]
                if isinstance(val, str):
                    return [val]
    return [
        re.sub(r"^[\s\-*•\d.]+", "", line).strip()
        for line in re.split(r"[\n,;]+", text)
        if re.sub(r"^[\s\-*•\d.]+", "", line).strip()
    ]


def resolve_tags_decision(raw: str, existing_tags: list[str]) -> list[str]:
    existing_by_slug: dict[str, str] = {}
    for name in existing_tags:
        slug = slugify_tag(name)
        if slug and slug not in existing_by_slug:
            existing_by_slug[slug] = name

    out: list[str] = []
    seen: set[str] = set()
    for candidate in _extract_candidates(raw):
        cleaned = _clean_tag_name(candidate)
        if not cleaned:
            continue
        slug = slugify_tag(cleaned)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        out.append(existing_by_slug.get(slug, cleaned))
        if len(out) >= MAX_TAGS:
            break
    return out


def pick_folder_id(current: str | None, candidate: str | None) -> str | None:
    return current if current is not None else candidate


async def generate_content_tags(
    *,
    title: str,
    content: str,
    existing_tags: list[str],
    api_key: str,
    model: str,
    fallback_model: str | None = None,
    language: str = "pt-BR",
    client: httpx.AsyncClient | None = None,
) -> TagsGenerationResult:
    """Gera tags via OpenRouter (mesmo contrato do tags-generate.ts)."""
    # Import local evita ciclo com openrouter → tags no futuro.
    from .openrouter import _chat_completion_document  # noqa: PLC2701

    excerpt = content.strip().replace("\x00", " ")[:4_000]
    tags_block = (
        "\n".join(f"- {name}" for name in existing_tags[:120]) if existing_tags else "(none yet)"
    )
    if language == "en":
        system = (
            "You tag content for a personal knowledge base. Return 1-5 short tags "
            "(1-3 words each). Reuse an existing tag verbatim "
            "when it fits; only invent a new one when none applies. Never write a sentence."
        )
        user = (
            f"Title: {title.strip() or '(no title)'}\n"
            f"Existing tags (reuse these when they fit):\n{tags_block}\n\n"
            'Return tags such as ["Anime","Review","Studio Ghibli"].\n'
            "Prefer 2-4 relevant tags. No duplicates. No sentences.\n\n"
            f"Content excerpt:\n{excerpt}"
        )
    else:
        system = (
            "Você cria tags para uma base de conhecimento pessoal. Retorne de 1 a 5 "
            "tags curtas (1-3 palavras cada). Reutilize uma tag "
            "existente exatamente quando couber; só invente nova quando nenhuma servir. "
            "Nunca escreva frase."
        )
        user = (
            f"Título: {title.strip() or '(sem título)'}\n"
            f"Tags existentes (reutilize quando couber):\n{tags_block}\n\n"
            'Retorne tags como ["Anime","Review","Estúdio Ghibli"].\n'
            "Prefira 2-4 tags relevantes. Sem duplicatas. Sem frases.\n\n"
            f"Trecho do conteúdo:\n{excerpt}"
        )

    payload: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 256,
        "reasoning": {"enabled": False},
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "content_tags",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "tags": {
                            "type": "array",
                            "items": {"type": "string", "minLength": 2, "maxLength": 40},
                            "minItems": 1,
                            "maxItems": MAX_TAGS,
                        }
                    },
                    "required": ["tags"],
                    "additionalProperties": False,
                },
            },
        },
        "usage": {"include": True},
    }
    result = await _chat_completion_document(
        payload=payload,
        api_key=api_key,
        model=model,
        fallback_model=fallback_model,
        client=client,
    )
    tags = resolve_tags_decision(result.text, existing_tags)
    return TagsGenerationResult(
        tags=tags,
        cost_usd=result.cost_usd,
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
    )
