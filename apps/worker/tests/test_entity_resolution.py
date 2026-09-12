from __future__ import annotations

from src.entity_resolution import (
    EntityCandidate,
    entity_identity_key,
    select_entity_candidate,
)


def candidate(
    node_id: str,
    *,
    canonical_name: str = "OpenAI",
    entity_type: str = "ORGANIZATION",
    aliases: tuple[str, ...] = ("OpenAI",),
    confidence: float = 0.95,
) -> EntityCandidate:
    return EntityCandidate(
        node_id=node_id,
        canonical_name=canonical_name,
        entity_type=entity_type,
        aliases=aliases,
        confidence=confidence,
    )


def test_unique_compatible_high_confidence_alias_is_reused() -> None:
    selected = select_entity_candidate(
        label="Open AI",
        entity_type="ORGANIZATION",
        aliases=("OpenAI",),
        candidates=[candidate("openai")],
    )

    assert selected == "openai"


def test_ambiguous_alias_never_selects_a_winner() -> None:
    selected = select_entity_candidate(
        label="Mercury",
        entity_type="OTHER",
        aliases=(),
        candidates=[
            candidate("planet", canonical_name="Mercury", entity_type="PLACE"),
            candidate("company", canonical_name="Mercury", entity_type="ORGANIZATION"),
        ],
    )

    assert selected is None


def test_same_name_and_type_without_alias_evidence_does_not_merge() -> None:
    selected = select_entity_candidate(
        label="John Smith",
        entity_type="PERSON",
        aliases=(),
        candidates=[candidate("john-1", canonical_name="John Smith", entity_type="PERSON")],
    )

    assert selected is None


def test_incompatible_entity_type_is_not_merged() -> None:
    selected = select_entity_candidate(
        label="Apple",
        entity_type="PRODUCT",
        aliases=(),
        candidates=[candidate("company", canonical_name="Apple", entity_type="ORGANIZATION")],
    )

    assert selected is None


def test_ambiguous_identity_key_is_deterministic_but_distinct_from_base_key() -> None:
    base = entity_identity_key(
        label="John Smith", entity_type="PERSON", aliases=(), ambiguous=False
    )
    ambiguous = entity_identity_key(
        label="John Smith",
        entity_type="PERSON",
        aliases=("Dr. John Smith",),
        ambiguous=True,
    )

    assert base == "ENTITY:person:john-smith"
    assert ambiguous.startswith("ENTITY:person:john-smith:")
    assert ambiguous != base
