---
tipo: fix
titulo: Patch Node.js and Bun Brotli runtimes (CVE-2026-111497)
---

### Fixed
- Pinned Node.js to 22.23.4 and Bun to 1.4.4 across Docker build/runtime stages, CI jobs, and supported-version floors.
- Web image now copies Node.js from the pinned builder stage instead of the floating Alpine package.
- Added a static regression test so older runtime lines fail fast.
