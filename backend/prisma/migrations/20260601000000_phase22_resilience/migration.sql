-- Phase 22 — platform reliability & resilience
--
-- Schema changes (apply with `npx prisma migrate deploy`):
--
--   1. JobStatus gains FAILED_PERMANENT (dead-letter terminal state).
--   2. Job: lockedAt + lockedBy (stuck-job sweeper) + correlationId
--      (request tracing).
--   3. Session: deviceFingerprint + lastIp + lastUserAgent (new-device
--      detection + session forensics).
--   4. School: maintenanceScheduledStart/End + maintenanceMessage
--      (scheduled maintenance windows).
--   5. PlatformAuditEvent: correlationId.
--   6. Notification: correlationId.
--   7. New enums: IncidentSeverity, IncidentStatus, IncidentScope.
--   8. New table: platform_incidents (operator-broadcast incidents
--      with active/resolved lifecycle).

-- ---- Enums ----------------------------------------------------------

ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'FAILED_PERMANENT';

CREATE TYPE "IncidentSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "IncidentStatus" AS ENUM ('ACTIVE', 'RESOLVED');
CREATE TYPE "IncidentScope" AS ENUM ('ALL_SCHOOLS', 'SPECIFIC_SCHOOLS');

-- ---- Job: stuck-job sweeper + correlation ---------------------------

ALTER TABLE "jobs" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "jobs" ADD COLUMN "correlationId" TEXT;

CREATE INDEX "jobs_lockedAt_idx" ON "jobs"("lockedAt");
CREATE INDEX "jobs_correlationId_idx" ON "jobs"("correlationId");

-- ---- Session: device fingerprint + last-observed network info -------

ALTER TABLE "sessions" ADD COLUMN "deviceFingerprint" TEXT;
ALTER TABLE "sessions" ADD COLUMN "lastIp" TEXT;
ALTER TABLE "sessions" ADD COLUMN "lastUserAgent" TEXT;

CREATE INDEX "sessions_deviceFingerprint_idx" ON "sessions"("deviceFingerprint");

-- ---- School: scheduled maintenance window ---------------------------

ALTER TABLE "schools" ADD COLUMN "maintenanceScheduledStart" TIMESTAMP(3);
ALTER TABLE "schools" ADD COLUMN "maintenanceScheduledEnd"   TIMESTAMP(3);
ALTER TABLE "schools" ADD COLUMN "maintenanceMessage"        VARCHAR(500);

-- ---- Audit + notification: correlation ids --------------------------

ALTER TABLE "platform_audit_events" ADD COLUMN "correlationId" TEXT;
CREATE INDEX "platform_audit_events_correlationId_idx" ON "platform_audit_events"("correlationId");

ALTER TABLE "notifications" ADD COLUMN "correlationId" TEXT;

-- ---- platform_incidents ---------------------------------------------

CREATE TABLE "platform_incidents" (
  "id"               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"            VARCHAR(160) NOT NULL,
  "body"             TEXT         NOT NULL,
  "severity"         "IncidentSeverity" NOT NULL,
  "status"           "IncidentStatus"   NOT NULL DEFAULT 'ACTIVE',
  "targetScope"     "IncidentScope"    NOT NULL,
  "targetSchoolIds" JSONB,
  "createdById"     UUID         NOT NULL,
  "resolvedById"    UUID,
  "resolvedAt"      TIMESTAMP(3),
  "inAppFanOut"     INT          NOT NULL DEFAULT 0,
  "emailFanOut"     INT          NOT NULL DEFAULT 0,
  "correlationId"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

CREATE INDEX "platform_incidents_status_createdAt_idx"
  ON "platform_incidents"("status", "createdAt" DESC);

CREATE INDEX "platform_incidents_severity_createdAt_idx"
  ON "platform_incidents"("severity", "createdAt" DESC);

CREATE INDEX "platform_incidents_correlationId_idx"
  ON "platform_incidents"("correlationId");
