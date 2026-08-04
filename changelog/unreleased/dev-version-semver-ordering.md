---
tipo: fix
titulo: Development builds now stay ahead of the stable release
---

The automated development-version workflow now compares its package version
with `main`. When both point to the same release core, the next development
build advances to the following patch before adding its timestamp, preserving
correct SemVer ordering for deployments and update detection.
