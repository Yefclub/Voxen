---
tipo: chore
titulo: Remove server-side agentic chat runtime and API
---

### Removed
- The built-in agentic chat runtime is gone from the server: no more /api/chat routes, turn reconciliation, model routing, HITL approvals, or chat tool execution.
- Chat history tables stay untouched in this step and will be archived and dropped in a dedicated migration. The chat UI shell will be removed separately.
