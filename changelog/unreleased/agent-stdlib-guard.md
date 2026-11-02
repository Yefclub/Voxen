---
tipo: chore
titulo: Guard agent tooling stdlib-only contract
---

### Added
- `scripts/agent-stdlib-only.test.mjs` locks agent tooling to stdlib plus relative imports with no model-provider configuration, keeping transient agent tooling out of the application runtime.
