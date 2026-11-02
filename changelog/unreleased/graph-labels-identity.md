---
tipo: feat
titulo: Measured graph labels and stable refresh identity
---

### Added
- Canvas labels resolve collisions with measured per-frame text rectangles (4-side placement, deterministic tie-breaks) instead of truncation alone; hover boxes are measured and viewport-clamped.
- Graph topology key is order-invariant, so equivalent server responses keep camera/node identity instead of refitting.
