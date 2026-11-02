---
tipo: feat
titulo: Benchmark measures continuation reuse
---

### Added
- Retrieval benchmark now measures page-2 continuation via `content_cursor`, proving the page is served from the prepared result (same checksum) within the MCP latency budget.
