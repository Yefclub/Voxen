---
tipo: feat
titulo: Explicit enumeration completion on list tools
---

### Added
- List tools (`voxen_list_transcripts`, `voxen_list_notes`, `voxen_list_note_revisions`, `voxen_list_transcript_corrections`) return an explicit `hasMore`; `false` with a null cursor means complete enumeration of the defined set.
