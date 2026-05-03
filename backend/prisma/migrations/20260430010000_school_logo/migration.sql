-- Idempotent: add nullable logoUrl column to schools.
ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
