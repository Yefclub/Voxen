---
tipo: feat
titulo: Explicit truncation on brain navigation tools
---

### Added
- `voxen_brain_search`, `voxen_brain_neighbors`, `voxen_brain_sources`, `voxen_brain_hubs` and `voxen_brain_timeline` return an explicit `truncated` flag; `false` means complete enumeration of the queried set.
