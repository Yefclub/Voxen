---
tipo: feat
titulo: Explicit truncation on related documents
---

### Added
- `voxen_related` returns an explicit `truncated` flag over the fused graph + FTS candidate set; a full page never implies complete enumeration.
