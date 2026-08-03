-- Interface layout is a personal preference. Keeping the default on the
-- column makes existing users and non-application writers fail safe to the
-- current shell.
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "interfaceMode" TEXT NOT NULL DEFAULT 'classic';
