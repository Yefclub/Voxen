-- Preferência de tema por usuário (spec 073).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'zinc';
