-- Cancela jobs pendentes do Produto 2 no upgrade (spec 215, issue #894).
-- O worker de análise foi removido e o executor web retém só DELETE_KNOWLEDGE;
-- sem este fechamento explícito, jobs QUEUED/RUNNING dos tipos removidos
-- ficariam presos para sempre sem ninguém para executá-los.
-- Idempotente: UPDATE com filtro de status é re-executável.
UPDATE "Job"
SET status = 'CANCELLED'::"JobStatus",
    "workerId" = NULL,
    "heartbeatAt" = NULL,
    "leaseExpiresAt" = NULL,
    "progressStage" = 'cancelled',
    "finishedAt" = NOW(),
    "errorMsg" = 'Cancelado no upgrade: execução interna do Produto 2 removida (spec 215).'
WHERE status IN ('QUEUED'::"JobStatus", 'RUNNING'::"JobStatus")
  AND type <> 'DELETE_KNOWLEDGE'::"JobType";
