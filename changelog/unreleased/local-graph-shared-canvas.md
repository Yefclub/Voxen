---
tipo: feat
titulo: Local transcript graph on the shared canvas with combobox search
---

### Added
- Transcript knowledge graph renders through the shared `KnowledgeGraphCanvas` (measured labels, framed camera, SVG fallback) with container-query workspace (map + scroll-bounded inspector) instead of the inline SVG and tab strip; scope switches through a labeled `Select`.
- Server-side graph search is a Base UI `Combobox` (auto-highlight, empty state, translated node types) with the same test hooks and focus-clear action; popup motion (`base-popup`) lives in `overlay.css`.
- New `graph-containers.css` holds local/global workspace containers; new `local-graph-contract` test pins the structure.
