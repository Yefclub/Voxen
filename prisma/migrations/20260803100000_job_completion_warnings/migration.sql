ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'COMPLETED_WITH_WARNINGS';

-- Conteúdos já gravados continuam disponíveis, mas não podem aparecer como
-- totalmente concluídos enquanto os enriquecimentos obrigatórios aguardam.
UPDATE "Job" j
SET status = 'COMPLETED_WITH_WARNINGS'::"JobStatus",
    "progressStage" = 'completed_with_warnings',
    "progressPercent" = 100,
    "progressedAt" = NOW()
FROM "Transcript" t
WHERE j."transcriptId" = t.id
  AND j.status = 'DONE'::"JobStatus"
  AND (
    t."summaryStatus" IN ('PENDING'::"EnrichmentStatus", 'RUNNING'::"EnrichmentStatus", 'RETRY'::"EnrichmentStatus")
    OR t."taggingStatus" IN ('PENDING'::"EnrichmentStatus", 'RUNNING'::"EnrichmentStatus", 'RETRY'::"EnrichmentStatus")
  );
