---
tipo: feat
titulo: Section context in narrow reads
---

### Added
- Narrow reads (`voxen_read_lines`, `voxen_read_timespan`, `voxen_expand_context`) return the enclosing section (index navigable via `voxen_read_section`) while quoted lines stay unchanged.
