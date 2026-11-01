---
tipo: feat
titulo: Explicit truncation on ranked search
---

### Added
- Ranked MCP search tools return an explicit `truncated` flag computed with a take+1 probe, keeping deterministic ordering; docs state that a full page never implies complete enumeration.
