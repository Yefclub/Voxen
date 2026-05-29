DO $$
BEGIN
  CREATE TYPE "ContentStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'TRASH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "LibraryFolder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transcript"
  ADD COLUMN IF NOT EXISTS "folderId" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "ContentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trashedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LibraryFolder_userId_fkey'
  ) THEN
    ALTER TABLE "LibraryFolder"
      ADD CONSTRAINT "LibraryFolder_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LibraryFolder_parentId_fkey'
  ) THEN
    ALTER TABLE "LibraryFolder"
      ADD CONSTRAINT "LibraryFolder_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "LibraryFolder"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Transcript_folderId_fkey'
  ) THEN
    ALTER TABLE "Transcript"
      ADD CONSTRAINT "Transcript_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "LibraryFolder"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LibraryFolder_userId_parentId_idx"
  ON "LibraryFolder"("userId", "parentId");

CREATE INDEX IF NOT EXISTS "LibraryFolder_userId_updatedAt_idx"
  ON "LibraryFolder"("userId", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "Transcript_userId_status_createdAt_idx"
  ON "Transcript"("userId", "status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Transcript_userId_folderId_idx"
  ON "Transcript"("userId", "folderId");
