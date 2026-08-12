CREATE TABLE IF NOT EXISTS "MemoryShadowFence" (
  "userId" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemoryShadowFence_pkey" PRIMARY KEY ("userId")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'MemoryShadowFence_userId_fkey'
      AND conrelid = '"MemoryShadowFence"'::regclass
  ) THEN
    ALTER TABLE "MemoryShadowFence"
      ADD CONSTRAINT "MemoryShadowFence_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
