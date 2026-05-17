-- Partial unique index: garante que cada (userId, sourceUrl) tem no máximo
-- um Job ativo (QUEUED ou RUNNING). Resolve race condition em /api/jobs
-- POST quando 2 requests chegam simultaneamente com a mesma URL.
-- Schema do enum em camelCase ("QUEUED", "RUNNING") segue a convenção do
-- Prisma p/ Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS "Job_user_url_active_unique"
  ON "Job" ("userId", "sourceUrl")
  WHERE status IN ('QUEUED', 'RUNNING');
