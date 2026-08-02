DO $$ BEGIN
  CREATE TYPE "BrainCompilationStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED', 'FAILED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "BrainSource"
  ADD COLUMN IF NOT EXISTS "startLine" INTEGER,
  ADD COLUMN IF NOT EXISTS "endLine" INTEGER,
  ADD COLUMN IF NOT EXISTS "segmentKey" TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "BrainSource_userId_evidenceKey_key"
  ON "BrainSource"("userId", "evidenceKey");

CREATE TABLE IF NOT EXISTS "BrainCompilation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transcriptId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "status" "BrainCompilationStatus" NOT NULL DEFAULT 'PENDING',
  "totalSegments" INTEGER NOT NULL DEFAULT 0,
  "completedSegments" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrainCompilation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrainCompilation_transcriptId_key"
  ON "BrainCompilation"("transcriptId");
CREATE INDEX IF NOT EXISTS "BrainCompilation_userId_status_updatedAt_idx"
  ON "BrainCompilation"("userId", "status", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "BrainCompilationSegment" (
  "id" TEXT NOT NULL,
  "compilationId" TEXT NOT NULL,
  "segmentKey" TEXT NOT NULL,
  "status" "BrainCompilationStatus" NOT NULL DEFAULT 'PENDING',
  "startLine" INTEGER NOT NULL,
  "endLine" INTEGER NOT NULL,
  "startSec" INTEGER,
  "endSec" INTEGER,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrainCompilationSegment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrainCompilationSegment_compilationId_segmentKey_key"
  ON "BrainCompilationSegment"("compilationId", "segmentKey");
CREATE INDEX IF NOT EXISTS "BrainCompilationSegment_compilationId_status_idx"
  ON "BrainCompilationSegment"("compilationId", "status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainCompilation_userId_fkey') THEN
    ALTER TABLE "BrainCompilation"
      ADD CONSTRAINT "BrainCompilation_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainCompilation_transcriptId_fkey') THEN
    ALTER TABLE "BrainCompilation"
      ADD CONSTRAINT "BrainCompilation_transcriptId_fkey"
      FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainCompilationSegment_compilationId_fkey') THEN
    ALTER TABLE "BrainCompilationSegment"
      ADD CONSTRAINT "BrainCompilationSegment_compilationId_fkey"
      FOREIGN KEY ("compilationId") REFERENCES "BrainCompilation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
