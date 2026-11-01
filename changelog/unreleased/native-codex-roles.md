---
tipo: chore
titulo: Native Codex config and roles
---

### Added
- Project `.codex/config.toml` (concurrency bounds only; no provider/auth/telemetry) plus explicit `implementer` and read-only `code-reviewer` native roles with pinned model/effort.
- `scripts/native-agent-config.test.mjs` validates the native contract; `AGENTS.md` distinguishes native config from the `.agents` mirror; setup docs cover `.codex/`.
