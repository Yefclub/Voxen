-- Align legacy SQL defaults and referential actions with schema.prisma.
-- Prisma Client owns @updatedAt values, so these columns must not keep a
-- database-side default that is absent from the declarative data model.
ALTER TABLE "Automation" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "BrainCompilation" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "BrainCompilationSegment" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "BrainEdge" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "BrainNode" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "LibraryFolder" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Note" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ResearchArtifact" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Tag" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Automation"
  DROP CONSTRAINT "Automation_userId_fkey",
  ADD CONSTRAINT "Automation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutomationRun"
  DROP CONSTRAINT "AutomationRun_automationId_fkey",
  ADD CONSTRAINT "AutomationRun_automationId_fkey"
    FOREIGN KEY ("automationId") REFERENCES "Automation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  DROP CONSTRAINT "AutomationRun_userId_fkey",
  ADD CONSTRAINT "AutomationRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
