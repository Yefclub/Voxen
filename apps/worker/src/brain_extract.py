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
from hashlib import sha256
from typing import Any

import httpx

from . import openrouter
from .brain_extract_prompt import build_grounded_extract_prompt
from .temporal import parse_iso_timestamp

OR_BASE_URL = openrouter.OR_BASE_URL
MAX_ENTITIES, MAX_CLAIMS = 8, 6
MAX_TEXT = 6_000
ALIAS_CONFIDENCE_MIN = 0.9
BRAIN_GROUNDED_EXTRACT_VERSION = 3

_HEADING_RE = re.compile(r"^#{1,6}\s+\S")
_TIMESTAMP_RE = re.compile(r"^\s*\[(\d{1,2}):([0-5]?\d):([0-5]?\d)\]")


@dataclass(frozen=True)
class GroundedItem:
    kind: str  # entity | claim
    label: str
    excerpt: str
    confidence: float
    entity_type: str = "OTHER"
    aliases: tuple[str, ...] = ()
    local_ref: str = ""


@dataclass(frozen=True)
class GroundedRelation:
    subject: str
    predicate: str
    object: str
    kind: str
    excerpt: str
    confidence: float
    valid_from: str | None = None
    valid_to: str | None = None
    subject_ref: str = ""
    object_ref: str = ""


@dataclass(frozen=True)
class GroundedExtractionResult:
    items: list[GroundedItem]
    relations: list[GroundedRelation]
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


@dataclass(frozen=True)
class ExtractionSegment:
    """Trecho contíguo do documento com localização estável na versão atual."""

    key: str
    text: str
    start_line: int
    end_line: int
    start_sec: int | None
    end_sec: int | None


def parse_timestamp_seconds(line: str) -> int | None:
    """Lê o timestamp canônico `[hh:mm:ss]` no começo da linha."""
    match = _TIMESTAMP_RE.match(line)
    if not match:
        return None
    return int(match.group(1)) * 3_600 + int(match.group(2)) * 60 + int(match.group(3))


def segment_content(content: str, max_chars: int = MAX_TEXT) -> list[ExtractionSegment]:
    """Divide Markdown em blocos contíguos, preferindo headings/timestamps.

    Cada segmento fica abaixo do limite de contexto e conserva as linhas e os
    timestamps que o delimitam. O corte só ocorre entre linhas, exceto por uma
    linha isolada que exceda o limite — nesse caso ela é fracionada sem perder a
    referência de linha.
    """
    if max_chars < 80:
        raise ValueError("max_chars deve ser ao menos 80")
    lines = (content or "").replace("\x00", " ").splitlines()
    if not lines:
        return []

    segments: list[ExtractionSegment] = []
    current: list[str] = []
    start_line = 1

    def emit(end_line: int) -> None:
        nonlocal current
        text = "\n".join(current).strip()
        if not text:
            current = []
            return
        timestamps = [parse_timestamp_seconds(line) for line in current]
        secs = [sec for sec in timestamps if sec is not None]
        digest = sha256(text.encode("utf-8")).hexdigest()[:16]
        segments.append(
            ExtractionSegment(
                key=f"{start_line}:{end_line}:{digest}",
                text=text,
                start_line=start_line,
                end_line=end_line,
                start_sec=secs[0] if secs else None,
                end_sec=secs[-1] if secs else None,
            )
        )
        current = []

    for line_number, line in enumerate(lines, start=1):
        is_boundary = bool(_HEADING_RE.match(line) or parse_timestamp_seconds(line) is not None)
        proposed = "\n".join([*current, line]) if current else line
        # Os delimitadores são cortes preferenciais; o tamanho é o limite duro.
        should_cut = len(proposed) > max_chars or (
            is_boundary and len("\n".join(current)) >= max_chars // 2
        )
        if current and should_cut:
            emit(line_number - 1)
            start_line = line_number

        if len(line) <= max_chars:
            current.append(line)
            continue

        # Texto sem quebras pode vir de páginas raspadas. Particiona a linha,
        # mantendo a localização original para a evidência abrir o contexto.
        if current:
            emit(line_number - 1)
            start_line = line_number
        for offset in range(0, len(line), max_chars):
            current = [line[offset : offset + max_chars]]
            emit(line_number)
        start_line = line_number + 1

    if current:
        emit(len(lines))
    return segments


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

    def add(
        kind: str,
        label: object,
        excerpt: object,
        confidence: object = 0.7,
        entity_type: object = "OTHER",
        aliases: object = None,
        local_ref: object = None,
    ) -> None:
        if not isinstance(label, str) or not isinstance(excerpt, str):
            return
        lab = " ".join(label.split()).strip()
        exc = " ".join(excerpt.split()).strip()
        if len(lab) < 2 or len(exc) < 8:
            return
        if not is_grounded(exc, source_text):
            return
        slug = slugify_label(lab)
        normalized_ref = (
            re.sub(r"[^a-zA-Z0-9_.:-]+", "-", local_ref.strip())[:80]
            if isinstance(local_ref, str) and local_ref.strip()
            else ""
        )
        # Entity labels are not identities: two homonyms may legitimately
        # coexist in one segment. A model-provided local id is preferred; the
        # literal excerpt is the conservative fallback identity.
        identity = (
            f"{kind}:ref:{normalized_ref}"
            if normalized_ref
            else (
                f"entity:{slug}:{normalize_for_grounding(exc)}"
                if kind == "entity"
                else f"{kind}:{slug}"
            )
        )
        if not slug or identity in seen:
            return
        conf = 0.7
        if isinstance(confidence, (int, float)):
            conf = max(0.4, min(0.95, float(confidence)))
        normalized_entity_type = "OTHER"
        literal_aliases: tuple[str, ...] = ()
        if kind == "entity":
            from .entity_resolution import normalize_entity_type

            normalized_entity_type = normalize_entity_type(
                entity_type if isinstance(entity_type, str) else None
            )
            if isinstance(aliases, list):
                accepted: list[str] = []
                source_normalized = normalize_for_grounding(source_text)
                for raw_alias in aliases[:10]:
                    if not isinstance(raw_alias, str):
                        continue
                    alias = " ".join(raw_alias.split()).strip()[:80]
                    if (
                        len(alias) >= 2
                        and slugify_label(alias) != slug
                        and normalize_for_grounding(alias) in source_normalized
                        and alias not in accepted
                    ):
                        accepted.append(alias)
                    if len(accepted) >= 5:
                        break
                literal_aliases = tuple(accepted)
        seen.add(identity)
        out.append(
            GroundedItem(
                kind=kind,
                label=lab[:80],
                excerpt=exc[:400],
                confidence=conf,
                entity_type=normalized_entity_type,
                aliases=literal_aliases,
                local_ref=normalized_ref or identity,
            )
        )

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
                item.get("entity_type") or item.get("type"),
                item.get("aliases"),
                item.get("id") or item.get("local_id"),
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


def parse_grounded_relations(
    raw: str,
    source_text: str,
    items: list[GroundedItem],
) -> list[GroundedRelation]:
    """Aceita apenas relações entre itens extraídos e evidenciados no segmento."""
    text = (raw or "").strip()
    if not text or not items:
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
    if not isinstance(parsed, dict) or not isinstance(parsed.get("relations"), list):
        return []

    known_by_ref = {item.local_ref: item for item in items if item.local_ref}
    known_by_slug: dict[str, list[GroundedItem]] = {}
    for item in items:
        known_by_slug.setdefault(slugify_label(item.label), []).append(item)
    out: list[GroundedRelation] = []
    seen: set[tuple[str, str, str, str, str, str]] = set()
    kind_map = {
        "supports": "SUPPORTS",
        "contradicts": "CONTRADICTS",
        "same_as": "SAME_AS",
        "related_to": "RELATED_TO",
        "part_of": "PART_OF",
    }
    for relation in parsed["relations"][:12]:
        if not isinstance(relation, dict):
            continue
        subject = relation.get("subject")
        predicate = relation.get("predicate")
        obj = relation.get("object")
        excerpt = relation.get("excerpt") or relation.get("evidence")
        if not all(isinstance(value, str) for value in (subject, predicate, obj, excerpt)):
            continue
        assert isinstance(subject, str)
        assert isinstance(predicate, str)
        assert isinstance(obj, str)
        assert isinstance(excerpt, str)
        subject_label = " ".join(subject.split()).strip()[:80]
        object_label = " ".join(obj.split()).strip()[:80]
        predicate_label = " ".join(predicate.split()).strip()[:80]
        subject_ref_raw = relation.get("subject_id") or relation.get("subject_ref")
        object_ref_raw = relation.get("object_id") or relation.get("object_ref")
        subject_ref = str(subject_ref_raw).strip() if isinstance(subject_ref_raw, str) else ""
        object_ref = str(object_ref_raw).strip() if isinstance(object_ref_raw, str) else ""
        subject_matches = known_by_slug.get(slugify_label(subject_label), [])
        object_matches = known_by_slug.get(slugify_label(object_label), [])
        subject_item = known_by_ref.get(subject_ref) if subject_ref else None
        object_item = known_by_ref.get(object_ref) if object_ref else None
        if subject_item is None and len(subject_matches) == 1:
            subject_item = subject_matches[0]
        if object_item is None and len(object_matches) == 1:
            object_item = object_matches[0]
        kind = kind_map.get(str(relation.get("kind") or predicate_label).strip().lower())
        evidence = " ".join(excerpt.split()).strip()[:400]
        if (
            not subject_item
            or not object_item
            or not kind
            or subject_item.local_ref == object_item.local_ref
            or len(predicate_label) < 2
            or not is_grounded(evidence, source_text)
        ):
            continue
        confidence = relation.get("confidence", 0.7)
        conf = 0.7
        if isinstance(confidence, (int, float)):
            conf = max(0.4, min(0.95, float(confidence)))
        if kind == "SAME_AS" and (
            subject_item.kind != "entity"
            or object_item.kind != "entity"
            or conf < ALIAS_CONFIDENCE_MIN
        ):
            continue
        raw_valid_from = relation.get("valid_from", relation.get("validAt"))
        raw_valid_to = relation.get("valid_to", relation.get("invalidAt"))
        valid_from = parse_iso_timestamp(raw_valid_from)
        valid_to = parse_iso_timestamp(raw_valid_to)
        if (raw_valid_from is not None and valid_from is None) or (
            raw_valid_to is not None and valid_to is None
        ):
            continue
        if valid_from and valid_to and valid_to <= valid_from:
            continue
        key = (
            subject_item.local_ref,
            kind,
            object_item.local_ref,
            predicate_label.casefold(),
            valid_from or "",
            valid_to or "",
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(
            GroundedRelation(
                subject=subject_item.label,
                predicate=predicate_label,
                object=object_item.label,
                kind=kind,
                excerpt=evidence,
                confidence=conf,
                valid_from=valid_from,
                valid_to=valid_to,
                subject_ref=subject_item.local_ref,
                object_ref=object_item.local_ref,
            )
        )
    return out


async def extract_grounded_concepts(
    *,
    title: str,
    content: str,
    api_key: str,
    model: str,
    fallback_model: str | None = None,
    language: str = "pt-BR",
    client: httpx.AsyncClient | None = None,
) -> GroundedExtractionResult:
    """Chama OpenRouter para um segmento e devolve itens literalmente grounded."""
    body = (content or "").strip().replace("\x00", " ")
    if len(body) > MAX_TEXT:
        raise ValueError("segmento excede o limite de extração")
    # O título contextualiza o modelo, mas a evidência deve existir no segmento;
    # assim toda citação recebe uma localização verificável no documento.
    source_for_ground = body
    system, user = build_grounded_extract_prompt(title=title, body=body, language=language)

    payload: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    if fallback_model and fallback_model != model:
        payload["models"] = [fallback_model]
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
        openrouter._raise_for_openrouter_status(res)  # noqa: SLF001
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
    relations = parse_grounded_relations(str(raw), source_for_ground, items)
    return GroundedExtractionResult(
        items=items,
        relations=relations,
        cost_usd=cost,
        model=str(data.get("model") or model),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )
