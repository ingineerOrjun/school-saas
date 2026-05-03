-- ============================================================================
-- Announcements
-- ----------------------------------------------------------------------------
-- School-wide notice board. One row per posting; admin writes, every
-- authenticated user in the school reads. Newest-first feed via the
-- (schoolId, createdAt) index. Idempotent so re-running is a no-op.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "announcements" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "title"     VARCHAR(160) NOT NULL,
  "message"   TEXT         NOT NULL,
  "schoolId"  UUID         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- Tenant-scoped feed query: WHERE schoolId = $1 ORDER BY createdAt DESC.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'announcements_schoolId_createdAt_idx'
  ) THEN
    CREATE INDEX "announcements_schoolId_createdAt_idx"
      ON "announcements" ("schoolId", "createdAt");
  END IF;
END $$;

-- FK to schools — cascade on tenant delete so dropping a school takes
-- its announcements with it (no orphaned rows).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'announcements_schoolId_fkey'
  ) THEN
    ALTER TABLE "announcements"
      ADD CONSTRAINT "announcements_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
