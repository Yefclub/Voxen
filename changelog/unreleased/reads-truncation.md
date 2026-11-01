---
tipo: feat
titulo: Explicit truncation on outline and expand context
---

### Added
- `voxen_outline` and `voxen_expand_context` return an explicit `truncated` flag (outline cuts at 300 sections, reads at 200 lines); `false` means a complete page with no cap cut.
