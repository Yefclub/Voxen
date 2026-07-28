ALTER TABLE "ChatApproval"
ADD COLUMN "providerApprovalId" TEXT;

UPDATE "ChatApproval"
SET "providerApprovalId" = "id"
WHERE "providerApprovalId" IS NULL;

ALTER TABLE "ChatApproval"
ALTER COLUMN "providerApprovalId" SET NOT NULL;

CREATE UNIQUE INDEX "ChatApproval_userId_providerApprovalId_key"
ON "ChatApproval"("userId", "providerApprovalId");
