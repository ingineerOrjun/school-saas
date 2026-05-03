-- Idempotent: add nullable sectionId to teachers + FK + index.
ALTER TABLE "teachers"
  ADD COLUMN IF NOT EXISTS "sectionId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_sectionId_fkey'
  ) THEN
    ALTER TABLE "teachers"
      ADD CONSTRAINT "teachers_sectionId_fkey"
      FOREIGN KEY ("sectionId") REFERENCES "sections"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "teachers_sectionId_idx" ON "teachers"("sectionId");
