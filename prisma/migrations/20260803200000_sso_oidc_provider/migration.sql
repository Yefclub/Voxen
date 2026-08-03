-- Spec 160: provedores OIDC globais com configuração cifrada pela aplicação.
-- Não há FK em userId: ele é somente auditoria do criador, não ownership.
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "domainVerified" BOOLEAN NOT NULL DEFAULT false,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SsoProvider_providerId_key" ON "SsoProvider"("providerId");
CREATE INDEX "SsoProvider_domainVerified_disabledAt_idx"
    ON "SsoProvider"("domainVerified", "disabledAt");
