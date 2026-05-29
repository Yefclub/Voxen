DO $$ BEGIN
  CREATE TYPE "BrainSourceType" AS ENUM ('TRANSCRIPT', 'NOTE', 'FOLDER', 'JOB', 'CHAT', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BrainNodeType" AS ENUM ('CONTENT', 'FOLDER', 'ENTITY', 'TOPIC', 'CLAIM', 'EVENT', 'CLUSTER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BrainEdgeKind" AS ENUM (
    'BELONGS_TO',
    'LINKS_TO',
    'MENTIONS',
    'SUPPORTS',
    'CONTRADICTS',
    'SAME_AS',
    'PART_OF',
    'RELATED_TO',
    'NEXT_TO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BrainNode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "type" "BrainNodeType" NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "status" "ContentStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "sourceType" "BrainSourceType",
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrainNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BrainEdge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fromNodeId" TEXT NOT NULL,
  "toNodeId" TEXT NOT NULL,
  "kind" "BrainEdgeKind" NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
  "method" TEXT NOT NULL DEFAULT 'manual',
  "status" "ContentStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrainEdge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BrainSource" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nodeId" TEXT,
  "edgeId" TEXT,
  "sourceType" "BrainSourceType" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "chunkId" TEXT,
  "startSec" INTEGER,
  "endSec" INTEGER,
  "excerpt" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrainSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrainNode_userId_key_key" ON "BrainNode"("userId", "key");
CREATE INDEX IF NOT EXISTS "BrainNode_userId_type_updatedAt_idx" ON "BrainNode"("userId", "type", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "BrainNode_userId_status_type_idx" ON "BrainNode"("userId", "status", "type");
CREATE INDEX IF NOT EXISTS "BrainNode_userId_sourceType_sourceId_idx" ON "BrainNode"("userId", "sourceType", "sourceId");

CREATE UNIQUE INDEX IF NOT EXISTS "BrainEdge_userId_fromNodeId_toNodeId_kind_method_key"
  ON "BrainEdge"("userId", "fromNodeId", "toNodeId", "kind", "method");
CREATE INDEX IF NOT EXISTS "BrainEdge_userId_kind_updatedAt_idx" ON "BrainEdge"("userId", "kind", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "BrainEdge_userId_status_kind_idx" ON "BrainEdge"("userId", "status", "kind");
CREATE INDEX IF NOT EXISTS "BrainEdge_fromNodeId_idx" ON "BrainEdge"("fromNodeId");
CREATE INDEX IF NOT EXISTS "BrainEdge_toNodeId_idx" ON "BrainEdge"("toNodeId");

CREATE INDEX IF NOT EXISTS "BrainSource_userId_sourceType_sourceId_idx" ON "BrainSource"("userId", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "BrainSource_nodeId_idx" ON "BrainSource"("nodeId");
CREATE INDEX IF NOT EXISTS "BrainSource_edgeId_idx" ON "BrainSource"("edgeId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainNode_userId_fkey') THEN
    ALTER TABLE "BrainNode"
      ADD CONSTRAINT "BrainNode_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainEdge_userId_fkey') THEN
    ALTER TABLE "BrainEdge"
      ADD CONSTRAINT "BrainEdge_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainEdge_fromNodeId_fkey') THEN
    ALTER TABLE "BrainEdge"
      ADD CONSTRAINT "BrainEdge_fromNodeId_fkey"
      FOREIGN KEY ("fromNodeId") REFERENCES "BrainNode"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainEdge_toNodeId_fkey') THEN
    ALTER TABLE "BrainEdge"
      ADD CONSTRAINT "BrainEdge_toNodeId_fkey"
      FOREIGN KEY ("toNodeId") REFERENCES "BrainNode"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainSource_userId_fkey') THEN
    ALTER TABLE "BrainSource"
      ADD CONSTRAINT "BrainSource_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainSource_nodeId_fkey') THEN
    ALTER TABLE "BrainSource"
      ADD CONSTRAINT "BrainSource_nodeId_fkey"
      FOREIGN KEY ("nodeId") REFERENCES "BrainNode"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrainSource_edgeId_fkey') THEN
    ALTER TABLE "BrainSource"
      ADD CONSTRAINT "BrainSource_edgeId_fkey"
      FOREIGN KEY ("edgeId") REFERENCES "BrainEdge"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
