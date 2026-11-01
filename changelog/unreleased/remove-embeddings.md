---
tipo: chore
titulo: Remove built-in embedding inference and semantic rescue
---

### Removed
- Built-in embedding inference and semantic-rescue reranking are gone: retrieval is deterministic full-text search, and no model calls happen on reads.
- Removed the embedding settings, capability probe, hybrid benchmark path, and the worker embedding writer. Stored vectors from earlier versions are ignored and cleaned by existing metadata maintenance.
