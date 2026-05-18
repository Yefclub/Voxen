-- Migration: automações (spec 008)
-- Idempotente: usa IF NOT EXISTS + DO $$ pra rerodar sem quebrar.

-- Enums
DO $$ BEGIN
  CREATE TYPE "AutomationType" AS ENUM ('PERIODIC_SUMMARY', 'WEB_RESEARCH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AutomationFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AutomationStatus" AS ENUM ('ACTIVE', 'PAUSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AutomationDelivery" AS ENUM ('IN_APP', 'TELEGRAM', 'BOTH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Automation
CREATE TABLE IF NOT EXISTS "Automation" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "type"        "AutomationType" NOT NULL,
  "prompt"      TEXT NOT NULL,
  "frequency"   "AutomationFrequency" NOT NULL,
  "hour"        INTEGER NOT NULL,
  "minute"      INTEGER NOT NULL,
  "dayOfWeek"   INTEGER,
  "dayOfMonth"  INTEGER,
  "timezone"    TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "delivery"    "AutomationDelivery" NOT NULL DEFAULT 'IN_APP',
  "status"      "AutomationStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastRunAt"   TIMESTAMP(3),
  "nextRunAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "Automation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Automation_userId_idx" ON "Automation"("userId");
CREATE INDEX IF NOT EXISTS "Automation_status_nextRunAt_idx" ON "Automation"("status", "nextRunAt");

-- AutomationRun
CREATE TABLE IF NOT EXISTS "AutomationRun" (
  "id"            TEXT PRIMARY KEY,
  "automationId"  TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "status"        "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt"     TIMESTAMP(3),
  "finishedAt"    TIMESTAMP(3),
  "outputMd"      TEXT,
  "errorMessage"  TEXT,
  "tokensIn"      INTEGER NOT NULL DEFAULT 0,
  "tokensOut"     INTEGER NOT NULL DEFAULT 0,
  "costUsd"       DECIMAL(12, 6) NOT NULL DEFAULT 0,
  "noteId"        TEXT,
  "telegramSent"  BOOLEAN NOT NULL DEFAULT FALSE,
  "triggeredBy"   TEXT NOT NULL DEFAULT 'scheduler',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE,
  CONSTRAINT "AutomationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AutomationRun_automationId_createdAt_idx"
  ON "AutomationRun"("automationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AutomationRun_userId_createdAt_idx"
  ON "AutomationRun"("userId", "createdAt" DESC);
