---
tipo: chore
titulo: Remove the worker service and its pipeline
---

### Removed
- The Python worker is gone: no more capture pipeline, transcription, model calls, or enrichment scheduling in a separate service.
- Retained maintenance (knowledge deletions) runs in the web process with leases and retry budget; startup drain and interval recover pending work after restart.
- Docker Compose, the combined image, CI, quality gates, and branch protection no longer build, test, or require the worker.
