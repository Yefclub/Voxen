---
tipo: feat
titulo: Unified 2D canvas shared by full graph and local views
---

### Added
- Shared `KnowledgeGraphCanvas` component (Sigma 2D with measured labels, framed camera, resize repaint, zoom/viewport controls, SVG fallback) replacing the inline full-page canvas; page mounts it instead of duplicating orchestration.
- Canvas split into `knowledge-graph-canvas`, `graph-canvas-controls` and `graph-fallback-svg` so each file stays within the quality-gate size budget.
- `graph.focusSelection` and `graph.zoomLevel` labels (PT/EN) for the viewport controls.
