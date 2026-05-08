-- ============================================================================
-- Fees + Payments — initial schema (back-filled migration).
-- ----------------------------------------------------------------------------
-- The fee_structures / fee_assignments / payments tables and the
-- FeeFrequency / PaymentMethod enums were originally created via
-- `prisma db push` early in the project, so no migration file existed
-- for them. The very next migration in the history
-- (20260425120000_fees_class_scope_discounts) ALTERs `fee_structures`,
-- which works on the live DB but breaks the shadow-DB rebuild
-- `prisma migrate dev` runs to compute diffs.
--
-- This migration uses PLAIN CREATE statements (no IF NOT EXISTS) so
-- the schema engine reliably emits the DDL on the shadow DB. On the
-- live DB — where these objects already exist via the original
-- db push — this migration is marked as applied via
-- `prisma migrate resolve --applied 20260425115000_fees_payments_init`
-- so it never re-runs there.
--
-- See README in this folder (or the team's runbook) for the exact
-- one-time resolve command.
-- ============================================================================

-- 1. Enums --------------------------------------------------------------------

CREATE TYPE "FeeFrequency" AS ENUM ('MONTHLY', 'ONE_TIME');

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK', 'ESEWA', 'OTHER');

-- 2. fee_structures -----------------------------------------------------------

CREATE TABLE "fee_structures" (
  "id"        UUID            NOT NULL,
  "name"      TEXT            NOT NULL,
  "amount"    DOUBLE PRECISION NOT NULL,
  "frequency" "FeeFrequency"  NOT NULL,
  "schoolId"  UUID            NOT NULL,
  "createdAt" TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fee_structures_schoolId_name_key"
  ON "fee_structures" ("schoolId", "name");
CREATE INDEX "fee_structures_schoolId_idx"
  ON "fee_structures" ("schoolId");

ALTER TABLE "fee_structures"
  ADD CONSTRAINT "fee_structures_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. fee_assignments ----------------------------------------------------------

CREATE TABLE "fee_assignments" (
  "id"             UUID             NOT NULL,
  "amount"         DOUBLE PRECISION NOT NULL,
  "dueDate"        DATE             NOT NULL,
  "studentId"      UUID             NOT NULL,
  "feeStructureId" UUID             NOT NULL,
  "schoolId"       UUID             NOT NULL,
  "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "fee_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fee_assignments_schoolId_idx"
  ON "fee_assignments" ("schoolId");
CREATE INDEX "fee_assignments_studentId_idx"
  ON "fee_assignments" ("studentId");
CREATE INDEX "fee_assignments_dueDate_idx"
  ON "fee_assignments" ("dueDate");

ALTER TABLE "fee_assignments"
  ADD CONSTRAINT "fee_assignments_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fee_assignments"
  ADD CONSTRAINT "fee_assignments_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fee_assignments"
  ADD CONSTRAINT "fee_assignments_feeStructureId_fkey"
  FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. payments -----------------------------------------------------------------

CREATE TABLE "payments" (
  "id"              UUID             NOT NULL,
  "amount"          DOUBLE PRECISION NOT NULL,
  "date"            DATE             NOT NULL,
  "studentId"       UUID             NOT NULL,
  "feeAssignmentId" UUID,
  "receiptNumber"   VARCHAR(40),
  "notes"           TEXT,
  "method"          "PaymentMethod",
  "schoolId"        UUID             NOT NULL,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_schoolId_receiptNumber_key"
  ON "payments" ("schoolId", "receiptNumber");
CREATE INDEX "payments_schoolId_idx"
  ON "payments" ("schoolId");
CREATE INDEX "payments_studentId_idx"
  ON "payments" ("studentId");
CREATE INDEX "payments_feeAssignmentId_idx"
  ON "payments" ("feeAssignmentId");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_feeAssignmentId_fkey"
  FOREIGN KEY ("feeAssignmentId") REFERENCES "fee_assignments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
