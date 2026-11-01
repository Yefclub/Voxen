---
tipo: feat
titulo: Bounded reuse of expensive search results
---

### Added
- Continuation pages of ranked search reuse the prepared result within TTL/entry/byte limits with per-document version revalidation; cross-owner, altered-argument, expired, or changed content fails closed with restart guidance. No contract migration: same cursors and envelopes.
