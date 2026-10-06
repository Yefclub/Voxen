-- AlterTable
ALTER TABLE "OauthAccessToken" ADD COLUMN     "authorizationCodeId" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revoked" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OauthClient" ADD COLUMN     "applicationType" TEXT,
ADD COLUMN     "backchannelLogoutSessionRequired" BOOLEAN,
ADD COLUMN     "backchannelLogoutUri" TEXT,
ADD COLUMN     "clientCredentialsScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "clientDiscoveryId" TEXT,
ADD COLUMN     "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
ADD COLUMN     "jwks" TEXT,
ADD COLUMN     "jwksUri" TEXT;

-- AlterTable
ALTER TABLE "OauthConsent" ADD COLUMN     "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "OauthRefreshToken" ADD COLUMN     "authorizationCodeId" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "rotationReplayExpiresAt" TIMESTAMP(3),
ADD COLUMN     "rotationReplayResponse" TEXT;

-- CreateTable
CREATE TABLE "OauthResource" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "OauthResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OauthClientResource" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "OauthClientResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OauthClientAssertion" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OauthClientAssertion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OauthResource_identifier_key" ON "OauthResource"("identifier");

-- CreateIndex
CREATE INDEX "OauthClientResource_clientId_idx" ON "OauthClientResource"("clientId");

-- CreateIndex
CREATE INDEX "OauthClientResource_resourceId_idx" ON "OauthClientResource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "OauthClientResource_clientId_resourceId_key" ON "OauthClientResource"("clientId", "resourceId");

-- CreateIndex
CREATE INDEX "OauthClientAssertion_expiresAt_idx" ON "OauthClientAssertion"("expiresAt");

-- CreateIndex
CREATE INDEX "OauthAccessToken_authorizationCodeId_idx" ON "OauthAccessToken"("authorizationCodeId");

-- CreateIndex
CREATE INDEX "OauthRefreshToken_authorizationCodeId_idx" ON "OauthRefreshToken"("authorizationCodeId");

-- AddForeignKey
ALTER TABLE "OauthClientResource" ADD CONSTRAINT "OauthClientResource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OauthClientResource" ADD CONSTRAINT "OauthClientResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "OauthResource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;


-- Retain the legacy client identity columns while populating the new representation.
UPDATE "OauthClient" SET "applicationType" = CASE WHEN type IN ('web', 'native') THEN type ELSE NULL END;
