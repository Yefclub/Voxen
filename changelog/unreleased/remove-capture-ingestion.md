---
tipo: chore
titulo: Remove capture, auto-generation, research and saved-media paths
---

### Removed
- Capture and ingestion entrypoints are gone: jobs and upload routes, saved media, web share target, platform cookies, automations, research artifacts, and enrichment CRUD, on REST and MCP.
- No more automatic titles, summaries, tags, flows, folders, or research: generation endpoints, background enrichment, and provider-backed helpers are removed. Stored content, revisions, and graph evidence stay untouched.
- Capture and chat UI is gone too: queue, job detail, downloads, automations, artifacts, platform accounts, and chat pages now redirect to the library; unknown /api/* paths fail closed with 404 instead of serving the SPA shell.
