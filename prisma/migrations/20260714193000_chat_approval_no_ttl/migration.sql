-- HITL approvals no longer expire by wall-clock TTL (spec 090).
ALTER TABLE "ChatApproval" ALTER COLUMN "expiresAt" DROP NOT NULL;
