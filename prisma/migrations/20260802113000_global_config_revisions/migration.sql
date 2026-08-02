CREATE TABLE IF NOT EXISTS "ConfigRevision" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "actorUserId" TEXT,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConfigRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConfigRevisionChange" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "previousValue" TEXT,
    "nextValue" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ConfigRevisionChange_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "configRevisionId" TEXT;
ALTER TABLE "ChatTurn" ADD COLUMN IF NOT EXISTS "configRevisionId" TEXT;

-- Instâncias que já possuíam settings precisam de uma revisão inicial para que
-- execuções criadas logo após o deploy também sejam rastreáveis. Como os
-- valores já estão cifrados, a baseline registra apenas as chaves (segredos
-- continuam redigidos) e nunca tenta decifrá-los em SQL.
WITH baseline AS (
  INSERT INTO "ConfigRevision" ("id", "number", "isBaseline", "reason", "createdAt")
  SELECT
    'migration_' || md5(random()::text || clock_timestamp()::text),
    1,
    true,
    'Baseline criada na migração de auditoria.',
    CURRENT_TIMESTAMP
  WHERE EXISTS (SELECT 1 FROM "Setting" WHERE "scope" = 'GLOBAL'::"SettingScope" AND "userId" IS NULL)
    AND NOT EXISTS (SELECT 1 FROM "ConfigRevision")
  RETURNING "id"
)
INSERT INTO "ConfigRevisionChange" ("id", "revisionId", "key", "previousValue", "nextValue", "isSecret")
SELECT
  'migration_change_' || md5(random()::text || clock_timestamp()::text || setting."id"),
  baseline."id",
  setting."key",
  NULL,
  NULL,
  setting."key" ~* '(api[_-]?key|token|cookie|password|secret)'
FROM baseline
JOIN (
  SELECT DISTINCT ON ("key") "id", "key"
  FROM "Setting"
  WHERE "scope" = 'GLOBAL'::"SettingScope" AND "userId" IS NULL
  ORDER BY "key", "updatedAt" DESC, "id" DESC
) AS setting ON TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS "ConfigRevision_number_key" ON "ConfigRevision"("number");
CREATE INDEX IF NOT EXISTS "ConfigRevision_createdAt_idx" ON "ConfigRevision"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ConfigRevision_actorUserId_createdAt_idx" ON "ConfigRevision"("actorUserId", "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "ConfigRevisionChange_revisionId_key_key" ON "ConfigRevisionChange"("revisionId", "key");
CREATE INDEX IF NOT EXISTS "ConfigRevisionChange_key_idx" ON "ConfigRevisionChange"("key");
CREATE INDEX IF NOT EXISTS "Job_configRevisionId_idx" ON "Job"("configRevisionId");
CREATE INDEX IF NOT EXISTS "ChatTurn_configRevisionId_idx" ON "ChatTurn"("configRevisionId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConfigRevision_actorUserId_fkey') THEN
    ALTER TABLE "ConfigRevision" ADD CONSTRAINT "ConfigRevision_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConfigRevisionChange_revisionId_fkey') THEN
    ALTER TABLE "ConfigRevisionChange" ADD CONSTRAINT "ConfigRevisionChange_revisionId_fkey"
      FOREIGN KEY ("revisionId") REFERENCES "ConfigRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Job_configRevisionId_fkey') THEN
    ALTER TABLE "Job" ADD CONSTRAINT "Job_configRevisionId_fkey"
      FOREIGN KEY ("configRevisionId") REFERENCES "ConfigRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatTurn_configRevisionId_fkey') THEN
    ALTER TABLE "ChatTurn" ADD CONSTRAINT "ChatTurn_configRevisionId_fkey"
      FOREIGN KEY ("configRevisionId") REFERENCES "ConfigRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
