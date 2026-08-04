---
tipo: security
titulo: Patched vulnerable web and worker dependencies
---

Patched four HIGH-severity findings reported by the release security scan:

- `fast-uri` 3.1.5 resolves CVE-2026-18446;
- `ip-address` 10.3.1 resolves CVE-2026-69192;
- `aiohttp` 3.14.3 resolves CVE-2026-69244; and
- `cryptography` 50.0.0 resolves CVE-2026-69247.

The worker image now also requires its audited lockfile, installs it strictly,
and pins the `uv` installer image by version and digest. Dependency audits are
gating checks now that both ecosystems pass cleanly.
