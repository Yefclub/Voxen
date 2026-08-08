"""Durable, reviewable web research that never mutates the canonical summary."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx

from . import db, openrouter, research_db, voxen_settings
from .research_contract import (
    EXA_SEARCH_COST_USD,
    MAX_COMPLETION_PRICE_PER_MILLION_USD,
    MAX_COST_USD,
    MAX_PROMPT_PRICE_PER_MILLION_USD,
    MAX_PROVIDER_REQUEST_PRICE_USD,
    MAX_SEARCH_CALLS,
    ProviderUsage,
    ResearchOutputError,
    ResearchPlan,
    SearchResult,
    build_research_payload,
    build_research_plan_payload,
    parse_provider_usage,
    parse_research_plan,
    parse_search_response,
)
from .safe_diagnostics import error_diagnostic

REQUEST_TIMEOUT_SEC = 40.0
TOTAL_TIMEOUT_SEC = 90.0


@dataclass
class _UsageTotal:
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: Decimal = Decimal("0")
    search_calls: int = 0
    provider_calls: int = 0

    def add(self, usage: ProviderUsage) -> None:
        self.tokens_in += usage.tokens_in
        self.tokens_out += usage.tokens_out
        self.cost_usd += usage.cost_usd
        self.search_calls += usage.search_calls
        self.provider_calls += 1
        conservative_cost = self.cost_usd + (EXA_SEARCH_COST_USD * self.search_calls)
        if conservative_cost > MAX_COST_USD:
            raise ResearchOutputError("RESEARCH_COST_LIMIT_EXCEEDED")
        if self.search_calls > MAX_SEARCH_CALLS:
            raise ResearchOutputError("RESEARCH_SEARCH_LIMIT_EXCEEDED")


async def process(item: dict[str, Any], log: Any) -> None:  # noqa: ANN401
    enrichment_id = str(item["id"])
    user_id = str(item["userId"])
    transcript_id = str(item["transcriptId"])
    attempt = int(item["attempt"])
    usage = _UsageTotal()
    started = time.monotonic()
    plan: ResearchPlan | None = None
    results: list[SearchResult] = []
    model = ""

    config = await voxen_settings.get_openrouter_model_config(
        ("default_web_search_model", "default_chat_model")
    )
    if not config.api_key or not config.model:
        await research_db.fail_transcript_enrichment(
            enrichment_id=enrichment_id,
            user_id=user_id,
            attempt=attempt,
            retry=True,
            error="RESEARCH_CONFIG_MISSING",
        )
        return
    model = config.model

    try:
        async with asyncio.timeout(TOTAL_TIMEOUT_SEC):
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC) as client:
                plan_data = await _post_completion(
                    client,
                    config.api_key,
                    build_research_plan_payload(
                        model=config.model,
                        title=str(item.get("title") or ""),
                        summary=str(item.get("summaryMd") or ""),
                        transcript=str(item.get("plainText") or ""),
                    ),
                    fallback_model=config.fallback_model,
                )
                plan_usage = parse_provider_usage(plan_data, require_search=False)
                if plan_usage.search_calls != 0:
                    raise ResearchOutputError("RESEARCH_UNEXPECTED_PLANNER_TOOL_USE")
                usage.add(plan_usage)
                model = str(plan_data.get("model") or model)
                plan = parse_research_plan(
                    plan_data,
                    transcript=str(item.get("plainText") or ""),
                )

                for query in plan.queries:
                    search_data = await _post_completion(
                        client,
                        config.api_key,
                        build_research_payload(model=config.model, query=query),
                        fallback_model=config.fallback_model,
                    )
                    search_usage = parse_provider_usage(search_data, require_search=True)
                    if search_usage.search_calls != 1:
                        raise ResearchOutputError("RESEARCH_SEARCH_LIMIT_EXCEEDED")
                    usage.add(search_usage)
                    model = str(search_data.get("model") or model)
                    results.append(parse_search_response(search_data))

        await _record_cost_event(
            user_id=user_id,
            transcript_id=transcript_id,
            enrichment_id=enrichment_id,
            trigger=str(item.get("trigger") or ""),
            model=model,
            usage=usage,
            query_count=len(plan.queries),
            result_count=_unique_citation_count(results),
            latency_ms=round((time.monotonic() - started) * 1000),
            outcome=plan.decision,
            log=log,
        )

        if plan.decision == "no_research":
            persisted = await research_db.complete_transcript_enrichment(
                enrichment_id=enrichment_id,
                user_id=user_id,
                attempt=attempt,
                status="NO_RESEARCH_NEEDED",
                rationale=plan.rationale,
                no_research_reason=plan.no_research_reason,
                model=model,
                cost_usd=usage.cost_usd,
                tokens_in=usage.tokens_in,
                tokens_out=usage.tokens_out,
                search_call_count=usage.search_calls,
                search_result_count=0,
            )
        else:
            citations = _unique_citations(results)
            persisted = await research_db.complete_transcript_enrichment(
                enrichment_id=enrichment_id,
                user_id=user_id,
                attempt=attempt,
                status="READY",
                title=plan.title,
                content="\n\n".join(f"## {result.title}\n\n{result.content}" for result in results),
                citations=citations,
                queries=plan.queries,
                rationale=plan.rationale,
                model=model,
                cost_usd=usage.cost_usd,
                tokens_in=usage.tokens_in,
                tokens_out=usage.tokens_out,
                search_call_count=usage.search_calls,
                search_result_count=len(citations),
            )
        log.info(
            "research-enrichment-finished" if persisted else "research-enrichment-discarded",
            enrichment_id=enrichment_id,
            transcript_id=transcript_id,
            decision=plan.decision,
        )
    except ResearchOutputError as exc:
        await _record_failure_cost(
            item=item,
            model=model,
            usage=usage,
            results=results,
            plan=plan,
            started=started,
            outcome=str(exc),
            log=log,
        )
        await research_db.fail_transcript_enrichment(
            enrichment_id=enrichment_id,
            user_id=user_id,
            attempt=attempt,
            retry=False,
            error=str(exc),
        )
    except (TimeoutError, httpx.TransportError, openrouter.OpenrouterTransientError) as exc:
        await _record_failure_cost(
            item=item,
            model=model,
            usage=usage,
            results=results,
            plan=plan,
            started=started,
            outcome="RESEARCH_UPSTREAM_UNAVAILABLE",
            log=log,
        )
        log.warning(
            "research-enrichment-transient-failure",
            enrichment_id=enrichment_id,
            **error_diagnostic(exc, "RESEARCH_UPSTREAM_UNAVAILABLE"),
        )
        await research_db.fail_transcript_enrichment(
            enrichment_id=enrichment_id,
            user_id=user_id,
            attempt=attempt,
            retry=True,
            error="RESEARCH_UPSTREAM_UNAVAILABLE",
        )
    except Exception as exc:  # noqa: BLE001
        await _record_failure_cost(
            item=item,
            model=model,
            usage=usage,
            results=results,
            plan=plan,
            started=started,
            outcome="RESEARCH_FAILED",
            log=log,
        )
        log.error(
            "research-enrichment-failed",
            enrichment_id=enrichment_id,
            **error_diagnostic(exc, "RESEARCH_FAILED"),
        )
        await research_db.fail_transcript_enrichment(
            enrichment_id=enrichment_id,
            user_id=user_id,
            attempt=attempt,
            retry=False,
            error="RESEARCH_FAILED",
        )


async def _post_completion(
    client: httpx.AsyncClient,
    api_key: str,
    payload: dict[str, Any],
    fallback_model: str | None = None,
) -> dict[str, Any]:
    if fallback_model and fallback_model != payload.get("model"):
        payload = {**payload, "models": [fallback_model]}
    response = await client.post(
        f"{openrouter.OR_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json=payload,
    )
    if response.status_code in {401, 403}:
        raise ResearchOutputError("RESEARCH_AUTH_ERROR")
    if response.status_code == 429 or response.status_code >= 500:
        openrouter._raise_for_openrouter_status(response)  # noqa: SLF001
    if not response.is_success:
        raise ResearchOutputError("RESEARCH_UPSTREAM_REJECTED")
    try:
        data = response.json()
    except Exception as exc:  # noqa: BLE001
        raise ResearchOutputError("RESEARCH_RESPONSE_INVALID") from exc
    if not isinstance(data, dict):
        raise ResearchOutputError("RESEARCH_RESPONSE_INVALID")
    return data


async def _record_failure_cost(
    *,
    item: dict[str, Any],
    model: str,
    usage: _UsageTotal,
    results: list[SearchResult],
    plan: ResearchPlan | None,
    started: float,
    outcome: str,
    log: Any,  # noqa: ANN401
) -> None:
    if usage.provider_calls == 0:
        return
    await _record_cost_event(
        user_id=str(item["userId"]),
        transcript_id=str(item["transcriptId"]),
        enrichment_id=str(item["id"]),
        trigger=str(item.get("trigger") or ""),
        model=model,
        usage=usage,
        query_count=len(plan.queries) if plan else 0,
        result_count=_unique_citation_count(results),
        latency_ms=round((time.monotonic() - started) * 1000),
        outcome=outcome,
        log=log,
    )


async def _record_cost_event(
    *,
    user_id: str,
    transcript_id: str,
    enrichment_id: str,
    trigger: str,
    model: str,
    usage: _UsageTotal,
    query_count: int,
    result_count: int,
    latency_ms: int,
    outcome: str,
    log: Any,  # noqa: ANN401
) -> None:
    search_cost_usd = EXA_SEARCH_COST_USD * usage.search_calls
    inference_cost_usd = max(Decimal("0"), usage.cost_usd - search_cost_usd)
    try:
        await db.insert_cost_event(
            user_id=user_id,
            kind="WEB_SEARCH",
            model=model,
            tokens_in=usage.tokens_in,
            tokens_out=usage.tokens_out,
            cost_usd=usage.cost_usd,
            meta={
                "source": "transcript_research_enrichment",
                "transcript_id": transcript_id,
                "enrichment_id": enrichment_id,
                "trigger": trigger,
                "outcome": outcome,
                "provider_call_count": usage.provider_calls,
                "query_count": query_count,
                "search_call_count": usage.search_calls,
                "search_result_count": result_count,
                "provider_cost_usd": str(usage.cost_usd),
                "conservative_budget_cost_usd": str(
                    usage.cost_usd + (EXA_SEARCH_COST_USD * usage.search_calls)
                ),
                "research_inference_cost_usd": str(inference_cost_usd),
                "web_search_cost_usd": str(search_cost_usd),
                "cost_budget_usd": str(MAX_COST_USD),
                "max_prompt_price_per_million_usd": MAX_PROMPT_PRICE_PER_MILLION_USD,
                "max_completion_price_per_million_usd": MAX_COMPLETION_PRICE_PER_MILLION_USD,
                "max_provider_request_price_usd": MAX_PROVIDER_REQUEST_PRICE_USD,
                "latency_ms": latency_ms,
            },
        )
    except Exception as exc:  # noqa: BLE001
        log.error(
            "research-cost-event-failed",
            enrichment_id=enrichment_id,
            **error_diagnostic(exc, "RESEARCH_COST_EVENT_FAILED"),
        )


def _unique_citations(results: list[SearchResult]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in results:
        for citation in result.citations:
            url = str(citation.get("url") or "")
            if url and url not in seen:
                citations.append(citation)
                seen.add(url)
    return citations


def _unique_citation_count(results: list[SearchResult]) -> int:
    return len(_unique_citations(results))
