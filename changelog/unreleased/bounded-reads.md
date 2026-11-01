---
tipo: feat
titulo: Bounded version-aware reads with explicit errors
---

### Added
- Narrow transcript reads use a version-aware bounded cache (owner + document + revision, LRU 50 entries/8 MiB) instead of always re-reading storage.
- Explicit read failures: NOT_FOUND, UNAVAILABLE_SOURCE, STALE_REVISION (with current revision); no fabricated fallback content.
