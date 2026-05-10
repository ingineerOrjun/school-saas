-- Phase 23 — Productization & Commercial Readiness
--
-- Apply with `npx prisma migrate deploy`.

-- ---- Enums -----------------------------------------------------------

CREATE TYPE "AnnouncementAudience" AS ENUM (
  'ALL_SCHOOLS', 'ADMINS_ONLY', 'TEACHERS_ONLY', 'SPECIFIC_SCHOOLS'
);

CREATE TYPE "ExportRunStatus" AS ENUM (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED'
);

CREATE TYPE "ImportRunStatus" AS ENUM (
  'PENDING', 'VALIDATING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK'
);

-- ---- School: onboarding + brand --------------------------------------

ALTER TABLE "schools"
  ADD COLUMN "onboardingCompleted" BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN "onboardingStep"      VARCHAR(40) NOT NULL DEFAULT 'school-profile',
  ADD COLUMN "brandPrimaryColor"   VARCHAR(20),
  ADD COLUMN "brandAccentColor"    VARCHAR(20),
  ADD COLUMN "brandSlogan"         VARCHAR(160),
  ADD COLUMN "brandReceiptFooter"  VARCHAR(500);

-- ---- user_invitations ------------------------------------------------

CREATE TABLE "user_invitations" (
  "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "schoolId"       UUID         NOT NULL,
  "email"          VARCHAR(180) NOT NULL,
  "role"           "Role"       NOT NULL,
  "token"          VARCHAR(80)  NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "acceptedAt"     TIMESTAMP(3),
  "revokedAt"      TIMESTAMP(3),
  "invitedById"    UUID         NOT NULL,
  "acceptedUserId" UUID,
  "displayName"    VARCHAR(180),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_invitations_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "user_invitations_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "user_invitations_token_key" ON "user_invitations"("token");
CREATE UNIQUE INDEX "user_invitations_schoolId_email_key"
  ON "user_invitations"("schoolId", "email");
CREATE INDEX "user_invitations_schoolId_idx"  ON "user_invitations"("schoolId");
CREATE INDEX "user_invitations_expiresAt_idx" ON "user_invitations"("expiresAt");

-- ---- guardians + student_guardian_links -----------------------------

CREATE TABLE "guardians" (
  "id"           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "schoolId"     UUID         NOT NULL,
  "userId"       UUID,
  "fullName"     VARCHAR(180) NOT NULL,
  "email"        VARCHAR(180),
  "phone"        VARCHAR(40),
  "relationship" VARCHAR(40),
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guardians_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "guardians_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "guardians_schoolId_idx"             ON "guardians"("schoolId");
CREATE INDEX "guardians_schoolId_email_idx"       ON "guardians"("schoolId", "email");

CREATE TABLE "student_guardian_links" (
  "id"           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "studentId"    UUID         NOT NULL,
  "guardianId"   UUID         NOT NULL,
  "schoolId"     UUID         NOT NULL,
  "isPrimary"    BOOLEAN      NOT NULL DEFAULT FALSE,
  "relationship" VARCHAR(40),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_guardian_links_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE,
  CONSTRAINT "student_guardian_links_guardianId_fkey"
    FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE CASCADE,
  CONSTRAINT "student_guardian_links_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "student_guardian_links_studentId_guardianId_key"
  ON "student_guardian_links"("studentId", "guardianId");
CREATE INDEX "student_guardian_links_studentId_idx"  ON "student_guardian_links"("studentId");
CREATE INDEX "student_guardian_links_guardianId_idx" ON "student_guardian_links"("guardianId");
CREATE INDEX "student_guardian_links_schoolId_idx"   ON "student_guardian_links"("schoolId");

-- ---- support_notes ---------------------------------------------------

CREATE TABLE "support_notes" (
  "id"        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "schoolId"  UUID         NOT NULL,
  "authorId"  UUID         NOT NULL,
  "body"      TEXT         NOT NULL,
  "tone"      VARCHAR(20),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_notes_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "support_notes_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "support_notes_schoolId_createdAt_idx"
  ON "support_notes"("schoolId", "createdAt" DESC);

-- ---- platform_announcements + dismissals ----------------------------

CREATE TABLE "platform_announcements" (
  "id"              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"           VARCHAR(180)            NOT NULL,
  "body"            TEXT                    NOT NULL,
  "tone"            VARCHAR(20)             NOT NULL DEFAULT 'info',
  "audience"        "AnnouncementAudience"  NOT NULL DEFAULT 'ALL_SCHOOLS',
  "targetSchoolIds" JSONB,
  "publishedById"   UUID                    NOT NULL,
  "active"          BOOLEAN                 NOT NULL DEFAULT TRUE,
  "linkUrl"         VARCHAR(500),
  "expiresAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)            NOT NULL,
  CONSTRAINT "platform_announcements_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "platform_announcements_active_createdAt_idx"
  ON "platform_announcements"("active", "createdAt" DESC);

CREATE TABLE "announcement_dismissals" (
  "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "announcementId" UUID         NOT NULL,
  "userId"         UUID         NOT NULL,
  "dismissedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "announcement_dismissals_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "platform_announcements"("id") ON DELETE CASCADE,
  CONSTRAINT "announcement_dismissals_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "announcement_dismissals_announcementId_userId_key"
  ON "announcement_dismissals"("announcementId", "userId");
CREATE INDEX "announcement_dismissals_userId_idx"
  ON "announcement_dismissals"("userId");

-- ---- data_export_runs ------------------------------------------------

CREATE TABLE "data_export_runs" (
  "id"            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  "schoolId"      UUID              NOT NULL,
  "requestedById" UUID              NOT NULL,
  "entity"        VARCHAR(40)       NOT NULL,
  "filters"       JSONB             NOT NULL DEFAULT '{}',
  "format"        VARCHAR(10)       NOT NULL,
  "status"        "ExportRunStatus" NOT NULL DEFAULT 'PENDING',
  "outputUrl"     TEXT,
  "sizeBytes"     INT,
  "expiresAt"     TIMESTAMP(3),
  "errorMessage"  TEXT,
  "createdAt"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"     TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  CONSTRAINT "data_export_runs_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "data_export_runs_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "data_export_runs_schoolId_createdAt_idx"
  ON "data_export_runs"("schoolId", "createdAt" DESC);
CREATE INDEX "data_export_runs_status_idx" ON "data_export_runs"("status");

-- ---- import_runs -----------------------------------------------------

CREATE TABLE "import_runs" (
  "id"            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  "schoolId"      UUID              NOT NULL,
  "requestedById" UUID              NOT NULL,
  "entity"        VARCHAR(40)       NOT NULL,
  "filename"      VARCHAR(240)      NOT NULL,
  "totalRows"     INT               NOT NULL DEFAULT 0,
  "validRows"     INT               NOT NULL DEFAULT 0,
  "invalidRows"   INT               NOT NULL DEFAULT 0,
  "importedRows"  INT               NOT NULL DEFAULT 0,
  "status"        "ImportRunStatus" NOT NULL DEFAULT 'PENDING',
  "dryRunSummary" JSONB             NOT NULL DEFAULT '{}',
  "errorMessage"  TEXT,
  "createdAt"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"     TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  CONSTRAINT "import_runs_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "import_runs_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "import_runs_schoolId_createdAt_idx"
  ON "import_runs"("schoolId", "createdAt" DESC);
CREATE INDEX "import_runs_status_idx" ON "import_runs"("status");
