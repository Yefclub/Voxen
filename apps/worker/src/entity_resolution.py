"""Conservative, deterministic entity-resolution primitives."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from hashlib import sha256

ENTITY_TYPES = {
    "PERSON",
    "ORGANIZATION",
    "PRODUCT",
    "PROJECT",
    "PLACE",
    "CONCEPT",
    "OTHER",
}
MIN_RESOLUTION_CONFIDENCE = 0.9


def normalize_entity_text(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")[:120]


def normalize_local_ref(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""
    return re.sub(r"[^a-zA-Z0-9_.:-]+", "-", value.strip())[:80]


def slugify_label(label: str) -> str:
    return normalize_entity_text(label)[:80]


def normalize_entity_type(value: str | None) -> str:
    normalized = re.sub(r"[^A-Z]+", "_", str(value or "OTHER").upper()).strip("_")
    return normalized if normalized in ENTITY_TYPES else "OTHER"


@dataclass(frozen=True)
class EntityCandidate:
    node_id: str
    canonical_name: str
    entity_type: str
    aliases: tuple[str, ...]
    confidence: float


def select_entity_candidate(
    *,
    label: str,
    entity_type: str,
    aliases: tuple[str, ...],
    candidates: list[EntityCandidate],
) -> str | None:
    """Return one compatible strong candidate, or preserve ambiguity."""
    requested_type = normalize_entity_type(entity_type)
    normalized_observations = (
        normalize_entity_text(label),
        *(normalize_entity_text(value) for value in aliases),
    )
    observed_names = {normalized for normalized in normalized_observations if normalized}
    observed_aliases = {
        normalized
        for normalized in (normalize_entity_text(value) for value in aliases)
        if normalized
    }
    label_name = normalize_entity_text(label)
    qualified: list[str] = []
    for candidate in candidates:
        candidate_type = normalize_entity_type(candidate.entity_type)
        if requested_type != "OTHER" and candidate_type not in {requested_type, "OTHER"}:
            continue
        if float(candidate.confidence) < MIN_RESOLUTION_CONFIDENCE:
            continue
        candidate_names = {
            normalized
            for normalized in (
                normalize_entity_text(candidate.canonical_name),
                *(normalize_entity_text(x) for x in candidate.aliases),
            )
            if normalized
        }
        candidate_canonical = normalize_entity_text(candidate.canonical_name)
        candidate_aliases = {
            normalize_entity_text(value)
            for value in candidate.aliases
            if normalize_entity_text(value) != candidate_canonical
        }
        has_alias_evidence = bool(observed_aliases.intersection(candidate_names)) or (
            bool(label_name) and label_name in candidate_aliases
        )
        if not observed_names.isdisjoint(candidate_names) and has_alias_evidence:
            qualified.append(candidate.node_id)
    unique = list(dict.fromkeys(qualified))
    return unique[0] if len(unique) == 1 else None


def entity_identity_key(
    *,
    label: str,
    entity_type: str,
    aliases: tuple[str, ...],
    ambiguous: bool,
    context_key: str = "",
) -> str:
    normalized_type = normalize_entity_type(entity_type).casefold()
    slug = normalize_entity_text(label) or "unknown"
    base = f"ENTITY:{normalized_type}:{slug}"
    if not ambiguous:
        return base
    identity_material = "\0".join(
        [
            normalized_type,
            slug,
            *sorted(filter(None, (normalize_entity_text(alias) for alias in aliases))),
            context_key,
        ]
    )
    suffix = sha256(identity_material.encode("utf-8")).hexdigest()[:12]
    return f"{base}:{suffix}"
