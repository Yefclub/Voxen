---
tipo: feat
titulo: Explicit truncation on within-document search
---

### Added
- `voxen_search_note_content` and `voxen_search_transcript_content` (plus the HTTP search endpoints) return an explicit `truncated` flag computed with a limit+1 probe; a full page never implies complete enumeration of occurrences.
