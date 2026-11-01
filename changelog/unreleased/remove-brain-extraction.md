---
tipo: chore
titulo: Remove worker Brain model extraction and compilation scheduling
---

### Removed
- The worker no longer runs model-based Brain extraction: no grounded entity/claim extraction, no compilation dispatch, no brain queue in the enrichment round-robin.
- Deterministic graph indexing, reindex repair, and stored evidence are untouched.
