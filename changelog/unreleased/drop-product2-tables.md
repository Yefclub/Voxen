---
tipo: chore
titulo: Drop retired Product 2 tables with chat archive policy
---

### Removed
- Forward migration drops retired Product 2 tables and enums: conversations, chat turns/messages/approvals/leases, cost events, AI capability checks, automations, research artifacts, and memory shadow state.
- Chat history and cost records are archived first via scripts/export-chat-archive.sh (documented policy; derived/operational rows are intentionally not archived).
