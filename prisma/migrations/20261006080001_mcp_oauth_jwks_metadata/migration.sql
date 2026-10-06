-- New JWT key metadata is optional. Existing public/private key bytes are preserved.
ALTER TABLE "Jwks" ADD COLUMN "alg" TEXT, ADD COLUMN "crv" TEXT;
