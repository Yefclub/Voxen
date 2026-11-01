-- Migration: drop Product 2 tables and enums (spec 215, issue #894)
-- Idempotent: uses IF EXISTS so it can be re-run safely.
--
-- Retired conversational tables are archived BEFORE this migration runs:
--   scripts/export-chat-archive.sh (ChatMessage, ChatTurn, ChatApproval,
--   ChatCompactionLease, ChatStreamLease, Conversation, CostEvent).
-- Automation runs, MemoryShadow rows, AI capability checks, and research
-- artifacts are derived/operational data, not user content: they are not
-- archived. Retained tables (Transcript, Note, Brain*, Job, SavedMedia,
-- Chunk, Tag, LibraryFolder, settings, auth/MCP) are untouched.

-- Drop tables, children first (FKs point at Conversation/User/ConfigRevision).
DROP TABLE IF EXISTS "ChatMessage";
DROP TABLE IF EXISTS "ChatTurn";
DROP TABLE IF EXISTS "ChatApproval";
DROP TABLE IF EXISTS "ChatCompactionLease";
DROP TABLE IF EXISTS "ChatStreamLease";
DROP TABLE IF EXISTS "Conversation";
DROP TABLE IF EXISTS "CostEvent";
DROP TABLE IF EXISTS "AiCapabilityCheck";
DROP TABLE IF EXISTS "AutomationRun";
DROP TABLE IF EXISTS "Automation";
DROP TABLE IF EXISTS "ResearchArtifact";
DROP TABLE IF EXISTS "MemoryShadowWriter";
DROP TABLE IF EXISTS "MemoryShadowSubject";
DROP TABLE IF EXISTS "MemoryShadowFence";
DROP TABLE IF EXISTS "MemoryShadowConfig";

-- Drop enums that are no longer referenced by any remaining table.
DROP TYPE IF EXISTS "ChatApprovalStatus";
DROP TYPE IF EXISTS "ChatTurnStatus";
DROP TYPE IF EXISTS "ChatRole";
DROP TYPE IF EXISTS "ChatMessageKind";
DROP TYPE IF EXISTS "CostEventKind";
DROP TYPE IF EXISTS "AutomationType";
DROP TYPE IF EXISTS "AutomationFrequency";
DROP TYPE IF EXISTS "AutomationStatus";
DROP TYPE IF EXISTS "AutomationDelivery";
DROP TYPE IF EXISTS "AutomationRunStatus";
DROP TYPE IF EXISTS "ResearchArtifactType";
