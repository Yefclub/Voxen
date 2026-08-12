-- Temporal fact versions and reversible, evidence-backed entity aliases.
CREATE TABLE "BrainFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "edgeId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3),
    "validTo" TIMESTAMPTZ(3),
    "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMPTZ(3),
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "method" TEXT NOT NULL DEFAULT 'manual',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrainFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrainEntityAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityNodeId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'OTHER',
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "method" TEXT NOT NULL DEFAULT 'manual',
    "sourceType" "BrainSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "segmentKey" TEXT,
    "evidenceKey" TEXT NOT NULL,
    "invalidatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrainEntityAlias_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BrainSource" ADD COLUMN "factId" TEXT;
ALTER TABLE "BrainSource" ADD COLUMN "invalidatedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "BrainFact_userId_factKey_key" ON "BrainFact"("userId", "factKey");
CREATE INDEX "BrainFact_userId_validFrom_validTo_idx" ON "BrainFact"("userId", "validFrom", "validTo");
CREATE INDEX "BrainFact_userId_invalidatedAt_idx" ON "BrainFact"("userId", "invalidatedAt");
CREATE INDEX "BrainFact_userId_observedAt_idx" ON "BrainFact"("userId", "observedAt" DESC);
CREATE INDEX "BrainFact_edgeId_idx" ON "BrainFact"("edgeId");
CREATE UNIQUE INDEX "BrainEntityAlias_userId_evidenceKey_key" ON "BrainEntityAlias"("userId", "evidenceKey");
CREATE INDEX "BrainEntityAlias_userId_normalizedAlias_idx" ON "BrainEntityAlias"("userId", "normalizedAlias");
CREATE INDEX "BrainEntityAlias_userId_entityType_normalizedAlias_idx" ON "BrainEntityAlias"("userId", "entityType", "normalizedAlias");
CREATE INDEX "BrainEntityAlias_entityNodeId_idx" ON "BrainEntityAlias"("entityNodeId");
CREATE INDEX "BrainEntityAlias_userId_sourceType_sourceId_idx" ON "BrainEntityAlias"("userId", "sourceType", "sourceId");
CREATE INDEX "BrainEntityAlias_userId_invalidatedAt_idx" ON "BrainEntityAlias"("userId", "invalidatedAt");
CREATE INDEX "BrainSource_factId_idx" ON "BrainSource"("factId");
CREATE INDEX "BrainSource_userId_invalidatedAt_idx" ON "BrainSource"("userId", "invalidatedAt");

ALTER TABLE "BrainFact" ADD CONSTRAINT "BrainFact_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrainFact" ADD CONSTRAINT "BrainFact_edgeId_fkey"
  FOREIGN KEY ("edgeId") REFERENCES "BrainEdge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrainEntityAlias" ADD CONSTRAINT "BrainEntityAlias_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrainEntityAlias" ADD CONSTRAINT "BrainEntityAlias_entityNodeId_fkey"
  FOREIGN KEY ("entityNodeId") REFERENCES "BrainNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrainSource" ADD CONSTRAINT "BrainSource_factId_fkey"
  FOREIGN KEY ("factId") REFERENCES "BrainFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
