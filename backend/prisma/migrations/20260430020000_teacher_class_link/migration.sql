-- Idempotent: add nullable classId to teachers + FK + index.
ALTER TABLE "teachers"
  ADD COLUMN IF NOT EXISTS "classId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_classId_fkey'
  ) THEN
    ALTER TABLE "teachers"
      ADD CONSTRAINT "teachers_classId_fkey"
      FOREIGN KEY ("classId") REFERENCES "classes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "teachers_classId_idx" ON "teachers"("classId");
