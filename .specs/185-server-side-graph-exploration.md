# Spec 185 — Server-side graph exploration

## Context

The graph route currently loads only the 500 most recently updated nodes before
applying focus and search. A valid node outside that snapshot cannot be found or
focused, while totals and truncation describe only the already-truncated input.
Large knowledge bases therefore look incomplete even when indexing is healthy.

## Requirements

### Ubiquitous

- The system shall scope every graph count, snapshot, search, edge, and focus
  traversal to the authenticated user and active records.
- The system shall keep response sizes bounded to the existing node and edge
  budgets.
- The system shall report the complete candidate counts separately from the
  visible slice and shall mark bounded responses as truncated.
- The default snapshot shall prioritize canonical content and folders before
  derived concepts, with deterministic ordering inside each group.

### Event-driven

- When the graph opens without a focus, the server shall return a representative
  bounded snapshot and accurate database-wide candidate counts.
- When a focus id is requested, the server shall resolve that node before the
  snapshot cap and fetch its one- or two-hop neighborhood from the database.
- When a user searches the graph, the server shall search every active owned
  node rather than only nodes already rendered by the client.
- When a server search result is selected, the client shall request a focused
  graph slice and select that node.
- When focus is cleared, the client shall return to the representative snapshot.

### Unwanted behavior

- If a focus id belongs to another user or is inactive, then the response shall
  reveal neither the node nor its edges.
- If a search query is empty or too short, then the endpoint shall return no
  results without scanning the graph.
- If a traversal encounters edges whose endpoints are inactive or foreign, then
  those edges shall be excluded.

## Acceptance Criteria

- [x] Tests prove that a focus outside the newest 500 nodes is still returned.
- [x] Tests prove that search finds an owned node outside the rendered snapshot.
- [x] Tests prove that foreign search and focus data remain invisible.
- [x] Tests prove accurate candidate counts and truncation for a bounded snapshot.
- [x] The graph UI can select and clear a server-side search result.
- [x] Typecheck, lint, unit/integration tests, Playwright, Quality Gate, and image
      build pass.

## Out of Scope

- Changing semantic extraction models.
- Editing graph nodes or evidence.
- Unbounded client-side rendering.
- Replacing the current 2D/3D renderers.

> 2026-08-10: implementation follows the approved graph reliability roadmap.
