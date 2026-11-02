---
tipo: chore
titulo: Harden stdlib guard against dynamic loading
---

### Fixed
- `agent-stdlib-only` guard now also rejects `require`, dynamic `import`, and re-exports from unlisted modules in agent tooling.
