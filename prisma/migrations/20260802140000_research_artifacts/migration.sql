DO $$ BEGIN
  CREATE TYPE "ResearchArtifactType" AS ENUM ('BRIEFING', 'FAQ', 'STUDY_GUIDE', 'TIMELINE', 'MIND_MAP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ResearchArtifact" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, type "ResearchArtifactType" NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope JSONB NOT NULL DEFAULT '{}'::jsonb, "unavailableSources" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "configRevisionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchArtifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ResearchArtifact_configRevisionId_fkey" FOREIGN KEY ("configRevisionId") REFERENCES "ConfigRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ResearchArtifact_userId_createdAt_idx" ON "ResearchArtifact"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ResearchArtifact_configRevisionId_idx" ON "ResearchArtifact"("configRevisionId");
