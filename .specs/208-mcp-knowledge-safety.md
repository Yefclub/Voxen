# Spec 208 — Current MCP knowledge and truthful graph paths

## Context

A runtime audit reproduced reversed graph paths whose returned endpoints did
not match the requested nodes, trash visibility under archived queries, stale
enrichment evidence and domain mutations performed by read-only credentials.
The owner authorized the complete audit backlog; this increment covers
MCP-03, MCP-04, MCP-05, MCP-12 and their MCP-08 regression cases.

## Requirements

### Ubiquitous

- The system shall scope every graph path and evidence lookup to the authenticated owner.
- The system shall return the requested endpoints and ordered distinct nodes for graph paths of at most three edges.
- The system shall expose archived graph nodes only when requested and shall exclude trashed nodes in every mode.
- The system shall return evidence only when its owner and parent content are current and accessible.
- The system shall evaluate research freshness without changing research records or graph projections during read-only MCP calls.

### Event-driven

- When a client requests a graph path, the system shall return at most fifteen paths and shall preserve traversal direction independently of stored edge direction.
- When a client reads research, the system shall calculate and report version, checksum and expiry mismatches.

### State-driven

- While a research item is stale, expired, dismissed, unfinished or attached to trashed content, the system shall exclude it from factual graph evidence.

### Unwanted behavior

- If an evidence source is missing or belongs to another owner, then the system shall omit that evidence.
- If a graph path would revisit a node, then the system shall omit that cyclic walk.
- If the requested graph query exceeds its execution deadline, then the system shall terminate it without changing stored data.

## Acceptance criteria

- [x] Direct and two-/three-hop paths keep their requested endpoints with both stored edge orientations.
- [x] Paths contain no repeated nodes and respect the fifteen-result and three-hop limits.
- [x] Archived queries exclude trash and enforce owner isolation.
- [x] Trashed parent content cannot be read through research tools.
- [x] Evidence checks cover current owned transcripts, notes/folders and accepted current research; missing/foreign/stale sources are excluded.
- [x] Read-only research calls report computed freshness while stored records and graph nodes remain unchanged.
- [x] Existing tool names, response fields and approved user isolation remain compatible.
- [x] Focused regressions, complete pre-PR checks, independent review and the runtime build pass.

## Out of scope

Transport/version migration, OAuth schema migration, write concurrency and client setup UI are separate increments of the approved backlog.

## Risks and decisions

The graph path deadline is three seconds. Existing projection repair remains a
maintenance responsibility; read results enforce freshness independently of
whether that repair has run.

## CI security remediation

The first CI run detected newly indexed advisories in existing transitive
dependencies. Before this increment can merge, production resolution shall use
`source-map-js` 1.2.2, `proxy-addr` 2.0.8 and `multidict` 6.9.1 or newer compatible
6.x versions. Regenerate the frozen lockfiles and repeat dependency audits,
regressions, type checks and the actual build without relaxing security gates.

References: [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
[multidict advisory](https://github.com/aio-libs/multidict/security/advisories/GHSA-54p9-h82j-f925).
