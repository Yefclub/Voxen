---
tipo: fix
titulo: Revisão de pesquisas sem sobrescrever alterações simultâneas
---

### Fixed
- Require the observed research revision and checksum for manual review, editing and cancellation through MCP and the web API, preserving unsaved drafts on conflicts.
- Persist retryable graph synchronization together with saved research, hide obsolete graph evidence, and keep research reads free of repair side effects.
