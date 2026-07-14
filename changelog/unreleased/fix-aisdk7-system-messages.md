### Fixed

- Chat no longer crashes on AI SDK 7 when the conversation history includes server `SYSTEM` rows (compaction summaries / HITL responses); `streamText` opts into `allowSystemInMessages` for trusted DB history, and compaction uses `instructions` instead of deprecated `system`.
