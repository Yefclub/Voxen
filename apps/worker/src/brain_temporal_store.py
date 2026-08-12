"""Persistence boundary for temporal facts and evidence-backed entity identities."""

from __future__ import annotations

import json
import re
import secrets
import time
from datetime import UTC, datetime
from hashlib import sha256

import asyncpg

from .entity_resolution import (
    EntityCandidate,
    entity_identity_key,
    normalize_entity_text,
    normalize_entity_type,
    select_entity_candidate,
)


def _new_id() -> str:
    timestamp = format(int(time.time() * 1000), "x")[-8:]
    return f"c{timestamp}{secrets.token_hex(8)}"


def _timestamp_utc_naive(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("temporal timestamps must include an explicit timezone")
        return parsed.astimezone(UTC).replace(tzinfo=None)
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


async def upsert_evidence_source(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    transcript_id: str,
    edge_id: str,
    fact_id: str | None,
    segment: dict[str, object],
    evidence_key: str,
    excerpt: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO "BrainSource" (
            id, "userId", "edgeId", "factId", "sourceType", "sourceId", "startLine", "endLine",
            "startSec", "endSec", "segmentKey", "evidenceKey", excerpt, "createdAt"
        ) VALUES (
            $1, $2, $3, $4, 'TRANSCRIPT'::"BrainSourceType", $5, $6, $7,
            $8, $9, $10, $11, $12, NOW()
        ) ON CONFLICT ("userId", "evidenceKey") DO UPDATE SET
            "edgeId" = EXCLUDED."edgeId", "factId" = EXCLUDED."factId",
            "startLine" = EXCLUDED."startLine", "endLine" = EXCLUDED."endLine",
            "startSec" = EXCLUDED."startSec", "endSec" = EXCLUDED."endSec",
            excerpt = EXCLUDED.excerpt
        """,
        _new_id(),
        user_id,
        edge_id,
        fact_id,
        transcript_id,
        segment["start_line"],
        segment["end_line"],
        segment.get("start_sec"),
        segment.get("end_sec"),
        segment["key"],
        evidence_key,
        excerpt[:600],
    )


async def entity_alias_candidates(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    names: tuple[str, ...],
) -> list[EntityCandidate]:
    normalized = sorted(
        {normalize_entity_text(name) for name in names if normalize_entity_text(name)}
    )
    if not normalized:
        return []
    rows = await conn.fetch(
        """
        SELECT alias."entityNodeId", node.label,
               COALESCE(node.metadata->>'entityType', alias."entityType", 'OTHER') AS "entityType",
               MAX(alias.confidence)::float AS confidence,
               ARRAY_AGG(DISTINCT alias.alias ORDER BY alias.alias) AS aliases
        FROM "BrainEntityAlias" alias
        JOIN "BrainNode" node
          ON node.id = alias."entityNodeId"
         AND node."userId" = alias."userId"
         AND node.status = 'ACTIVE'::"ContentStatus"
        WHERE alias."userId" = $1
          AND alias."normalizedAlias" = ANY($2::text[])
        GROUP BY alias."entityNodeId", node.label, node.metadata, alias."entityType"
        """,
        user_id,
        normalized,
    )
    return [
        EntityCandidate(
            node_id=str(row["entityNodeId"]),
            canonical_name=str(row["label"]),
            entity_type=str(row["entityType"] or "OTHER"),
            aliases=tuple(str(value) for value in (row["aliases"] or [])),
            confidence=float(row["confidence"] or 0),
        )
        for row in rows
    ]


async def upsert_concept_node(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    key: str,
    node_type: str,
    label: str,
    entity_type: str = "OTHER",
) -> str:
    row = await conn.fetchrow(
        """
        INSERT INTO "BrainNode" (
            id, "userId", key, type, label, description, status, metadata,
            "sourceType", "sourceId", "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, $3, $4::"BrainNodeType", $5, $6, 'ACTIVE'::"ContentStatus",
            $7::jsonb, NULL, NULL, NOW(), NOW()
        )
        ON CONFLICT ("userId", key) DO UPDATE SET
            type = EXCLUDED.type, label = EXCLUDED.label,
            description = EXCLUDED.description,
            metadata = "BrainNode".metadata || EXCLUDED.metadata,
            "updatedAt" = NOW()
        RETURNING id
        """,
        _new_id(),
        user_id,
        key,
        node_type,
        label,
        "Conceito extraído com grounding (trecho literal no conteúdo).",
        json.dumps(
            {
                "method": "llm-grounded",
                **(
                    {"entityType": normalize_entity_type(entity_type)}
                    if node_type == "ENTITY"
                    else {}
                ),
            }
        ),
    )
    return str(row["id"])


async def resolve_entity_node(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    transcript_id: str,
    segment_key: str,
    label: str,
    entity_type: str,
    aliases: tuple[str, ...],
    excerpt: str,
) -> str:
    candidates = await entity_alias_candidates(conn, user_id=user_id, names=(label, *aliases))
    selected = select_entity_candidate(
        label=label,
        entity_type=entity_type,
        aliases=aliases,
        candidates=candidates,
    )
    if selected:
        return selected
    key = entity_identity_key(
        label=label,
        entity_type=entity_type,
        aliases=aliases,
        ambiguous=bool(candidates),
        context_key=f"{transcript_id}:{segment_key}:{excerpt}",
    )
    return await upsert_concept_node(
        conn,
        user_id=user_id,
        key=key,
        node_type="ENTITY",
        label=label,
        entity_type=entity_type,
    )


async def upsert_entity_aliases(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    transcript_id: str,
    segment_key: str,
    entity_node_id: str,
    label: str,
    aliases: tuple[str, ...],
    entity_type: str,
    confidence: float,
) -> None:
    for alias in dict.fromkeys((label, *aliases)):
        normalized = normalize_entity_text(alias)
        if not normalized:
            continue
        evidence_key = sha256(
            "\0".join(
                (transcript_id, segment_key, entity_node_id, normalized, "llm-grounded-alias")
            ).encode("utf-8")
        ).hexdigest()
        await conn.execute(
            """
            INSERT INTO "BrainEntityAlias" (
                id, "userId", "entityNodeId", alias, "normalizedAlias", "entityType",
                confidence, method, "sourceType", "sourceId", "segmentKey", "evidenceKey",
                "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, 'llm-grounded-alias',
                'TRANSCRIPT'::"BrainSourceType", $8, $9, $10, NOW(), NOW()
            ) ON CONFLICT ("userId", "evidenceKey") DO UPDATE SET
                alias = EXCLUDED.alias, confidence = EXCLUDED.confidence, "updatedAt" = NOW()
            """,
            _new_id(),
            user_id,
            entity_node_id,
            alias,
            normalized,
            normalize_entity_type(entity_type),
            confidence,
            transcript_id,
            segment_key,
            evidence_key,
        )


def _fact_key(
    *,
    from_node_id: str,
    to_node_id: str,
    kind: str,
    predicate: str,
    valid_from: str | None,
    valid_to: str | None,
) -> str:
    return sha256(
        "\0".join(
            (
                from_node_id,
                kind,
                to_node_id,
                re.sub(r"\s+", " ", predicate).strip().casefold(),
                valid_from or "",
                valid_to or "",
            )
        ).encode("utf-8")
    ).hexdigest()


async def upsert_fact(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    edge_id: str,
    from_node_id: str,
    to_node_id: str,
    kind: str,
    predicate: str,
    valid_from: str | None,
    valid_to: str | None,
    observed_at: datetime,
    confidence: float,
) -> str:
    fact_key = _fact_key(
        from_node_id=from_node_id,
        to_node_id=to_node_id,
        kind=kind,
        predicate=predicate,
        valid_from=valid_from,
        valid_to=valid_to,
    )
    row = await conn.fetchrow(
        """
        INSERT INTO "BrainFact" (
            id, "userId", "edgeId", "factKey", predicate, "validFrom", "validTo",
            "observedAt", confidence, method, metadata, "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, $3, $4, $5, $6::timestamp, $7::timestamp,
            $8, $9, 'llm-grounded-temporal', '{}'::jsonb, NOW(), NOW()
        ) ON CONFLICT ("userId", "factKey") DO UPDATE SET
            "edgeId" = EXCLUDED."edgeId",
            confidence = GREATEST("BrainFact".confidence, EXCLUDED.confidence),
            "observedAt" = LEAST("BrainFact"."observedAt", EXCLUDED."observedAt"),
            "updatedAt" = NOW()
        RETURNING id
        """,
        _new_id(),
        user_id,
        edge_id,
        fact_key,
        predicate,
        _timestamp_utc_naive(valid_from),
        _timestamp_utc_naive(valid_to),
        _timestamp_utc_naive(observed_at),
        confidence,
    )
    return str(row["id"])
