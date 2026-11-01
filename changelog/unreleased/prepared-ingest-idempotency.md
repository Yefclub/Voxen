---
tipo: feat
titulo: Versioned prepared-content ingestion with idempotency
---

### Added
- Prepared-content contract v1 for notes over MCP (`voxen_create_note` + `voxen_import_notes` batch max 20, per-item outcomes) and HTTP `POST /api/notes` (duplicate returns original with `duplicate:true`; HTTP 200 vs 201).
- Workspace-scoped idempotency via `PreparedIngestKey` with contract version validation and race-safe claim.
