CREATE TABLE IF NOT EXISTS "MemoryShadowFence" (
  "userId" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemoryShadowFence_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "MemoryShadowWriter" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemoryShadowWriter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MemoryShadowWriter_userId_updatedAt_idx"
  ON "MemoryShadowWriter"("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "MemoryShadowSubject" (
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemoryShadowSubject_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "MemoryShadowConfig" (
  "id" TEXT NOT NULL,
  "scopeFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemoryShadowConfig_pkey" PRIMARY KEY ("id")
);
