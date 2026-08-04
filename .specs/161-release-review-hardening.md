# Spec 161 — Release review hardening

## Context

The independent review of the `v0.14.0` release candidate identified small but
material gaps in database defaults, SSO abuse controls, revalidation ordering,
documentation accuracy, release metadata, accessibility, and specification
closure. These fixes must land on `dev` before the release candidate is
refreshed.

## Requirements

- Database columns written by both Prisma and direct worker SQL shall retain a
  database-side `CURRENT_TIMESTAMP` default while Prisma keeps `@updatedAt`.
- Requesting an OIDC DNS challenge shall return the existing unexpired
  challenge instead of silently invalidating already-published TXT records.
- Public SSO initiation shall be rate-limited by client IP, and fallback domain
  lookup shall only load verified, enabled providers.
- Session-store mutations without loaded data shall not invalidate the initial
  request that can populate the store.
- Desktop scrollbar controls shall retain sufficient resting contrast in both
  supported color schemes.
- Easypanel documentation shall identify the combined published image and warn
  that repository/Dockerfile builds can expose environment values at build
  time.
- Security exceptions shall document their bounded rationale, owner, and review
  date; dependency overrides shall apply to every vulnerable dependency path.
- Production release metadata shall not claim that changes from an earlier
  release were promoted again.
- Architecture and implementation specifications shall reflect the routes and
  gates that are already delivered.

## Acceptance criteria

- [x] A new ordered migration restores all nine database defaults removed by
      `20260803180000_align_prisma_migration_history`.
- [x] Repeated DNS challenge requests return the same token until it expires.
- [x] SSO initiation returns `429` after the configured per-IP quota.
- [x] Tests cover the initial session request ordering and scrollbar contrast.
- [x] The root README documents `ghcr.io/yefclub/voxen:latest` and the
      Easypanel build-time secret risk.
- [x] The audit exception and global `ip-address` override are documented and
      lockfile-consistent.
- [x] The `0.13.1` production entry no longer duplicates promoted metadata.
- [x] Architecture and specs 154, 155, 158, and 159 match the shipped state.
- [x] Local lint, type checking, tests, production builds, migration gate,
      security audits, and quality gate pass.

> 2026-08-04: implementation authorized by the owner as part of the approved
> release completion work.
