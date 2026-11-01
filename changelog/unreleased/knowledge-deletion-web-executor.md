---
tipo: feat
titulo: Knowledge deletions finish in the web app without the worker
---

### Changed
- Permanent deletions of transcripts, notes, saved media, folders, and research now execute inside the web app and recover after restart; the analysis worker is no longer required for maintenance.
- Retired leases are reclaimed automatically with the same three-attempt budget, and cancelled deletions keep prior behavior.
