-- Phase α — backup_runs table.
-- Replaces the Phase 22 in-memory stub with a real persistent record
-- of pg_dump invocations + their artifact metadata.

CREATE TYPE "BackupRunKind"   AS ENUM ('FULL', 'INCREMENTAL', 'WAL');
CREATE TYPE "BackupRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

CREATE TABLE "backup_runs" (
  "id"             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"           "BackupRunKind"   NOT NULL DEFAULT 'FULL',
  "status"         "BackupRunStatus" NOT NULL DEFAULT 'PENDING',
  "storage"        VARCHAR(40)       NOT NULL,
  "location"       TEXT,
  "sizeBytes"      BIGINT,
  "sha256"         VARCHAR(64),
  "scheduled"      BOOLEAN           NOT NULL DEFAULT TRUE,
  "triggeredById"  UUID,
  "startedAt"      TIMESTAMP(3),
  "completedAt"    TIMESTAMP(3),
  "errorMessage"   TEXT,
  "retentionUntil" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "backup_runs_status_createdAt_idx"
  ON "backup_runs"("status", "createdAt" DESC);
CREATE INDEX "backup_runs_retentionUntil_idx"
  ON "backup_runs"("retentionUntil");
