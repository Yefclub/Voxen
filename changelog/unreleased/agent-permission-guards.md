---
tipo: chore
titulo: Agent permission guard contract
---

### Added
- `scripts/agent-permissions.test.mjs` locks the `.claude/settings.json` permission contract: no blanket shell/escalation, destructive git and supply-chain ops stay denied, no destructive gh scopes or credential paths in allow.
