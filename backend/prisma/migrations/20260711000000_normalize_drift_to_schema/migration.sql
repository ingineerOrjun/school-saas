-- =============================================================================
-- Normalize accumulated drift between hand-crafted migrations and schema.prisma
-- -----------------------------------------------------------------------------
-- Most migrations in this repo were hand-written (see e.g. 20260620000000_*).
-- They used patterns that don't match what `prisma migrate dev` would generate
-- today: server-side `DEFAULT gen_random_uuid()` on UUID PKs, server-side
-- `DEFAULT CURRENT_TIMESTAMP` on @updatedAt columns, plain `TIMESTAMP` instead
-- of `TIMESTAMP(3)`, and FK / index names from an older Prisma naming scheme
-- (`notifications_school_fkey` rather than `notifications_schoolId_fkey`).
--
-- Over time those choices accumulated as drift. `prisma migrate diff` against
-- the live dev DB consistently surfaced ~50 unrelated DDL operations on every
-- new schema change — the chunk below is exactly that diff, captured once and
-- applied to the dev DB so future `migrate dev` calls produce empty diffs.
--
-- Effect on running code:
--   • DROP DEFAULT on `id` columns: Prisma client supplies UUIDs at insert time
--     (`@default(uuid())` is client-side), so dropping the server default is
--     invisible to the app.
--   • DROP DEFAULT on `updatedAt`: Prisma client supplies the value (`@updatedAt`
--     is client-managed), so this is also invisible.
--   • TIMESTAMP → TIMESTAMP(3): keeps millisecond precision; existing data is
--     truncated below ms (negligible for app-level use).
--   • FK / index renames: pure metadata, no behavioral change.
--   • New `jobs_runAt_idx` and `sessions_userId_lastActiveAt_idx`: schema
--     declared them but no migration created them; adding now.
--
-- This file is the verbatim output of `prisma migrate dev --create-only` after
-- fixing the migration-order bug at 20260511020000_finalize_teaching_assignments.
-- =============================================================================

-- DropForeignKey
ALTER TABLE "announcement_dismissals" DROP CONSTRAINT "announcement_dismissals_announcementId_fkey";

-- DropForeignKey
ALTER TABLE "announcement_dismissals" DROP CONSTRAINT "announcement_dismissals_userId_fkey";

-- DropForeignKey
ALTER TABLE "data_export_runs" DROP CONSTRAINT "data_export_runs_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "data_export_runs" DROP CONSTRAINT "data_export_runs_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "guardians" DROP CONSTRAINT "guardians_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "guardians" DROP CONSTRAINT "guardians_userId_fkey";

-- DropForeignKey
ALTER TABLE "import_runs" DROP CONSTRAINT "import_runs_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "import_runs" DROP CONSTRAINT "import_runs_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_notification_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_school_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_fkey";

-- DropForeignKey
ALTER TABLE "platform_announcements" DROP CONSTRAINT "platform_announcements_publishedById_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_fkey";

-- DropForeignKey
ALTER TABLE "student_guardian_links" DROP CONSTRAINT "student_guardian_links_guardianId_fkey";

-- DropForeignKey
ALTER TABLE "student_guardian_links" DROP CONSTRAINT "student_guardian_links_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "student_guardian_links" DROP CONSTRAINT "student_guardian_links_studentId_fkey";

-- DropForeignKey
ALTER TABLE "support_notes" DROP CONSTRAINT "support_notes_authorId_fkey";

-- DropForeignKey
ALTER TABLE "support_notes" DROP CONSTRAINT "support_notes_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "user_invitations" DROP CONSTRAINT "user_invitations_invitedById_fkey";

-- DropForeignKey
ALTER TABLE "user_invitations" DROP CONSTRAINT "user_invitations_schoolId_fkey";

-- AlterTable
ALTER TABLE "announcement_dismissals" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "backup_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "data_export_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "guardians" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "jobs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "runAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notification_deliveries" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "sentAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "readAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "platform_announcements" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_audit_events" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "platform_incidents" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "school_subscriptions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "startDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "endDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "schools" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "lastActiveAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "revokedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "student_guardian_links" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "support_notes" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_invitations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "tokensValidAfter" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "jobs_runAt_idx" ON "jobs"("runAt");

-- CreateIndex
CREATE INDEX "sessions_userId_lastActiveAt_idx" ON "sessions"("userId", "lastActiveAt" DESC);

-- RenameForeignKey
ALTER TABLE "platform_audit_events" RENAME CONSTRAINT "platform_audit_events_actor_fkey" TO "platform_audit_events_actorUserId_fkey";

-- RenameForeignKey
ALTER TABLE "school_subscriptions" RENAME CONSTRAINT "school_subscriptions_creator_fkey" TO "school_subscriptions_createdById_fkey";

-- RenameForeignKey
ALTER TABLE "school_subscriptions" RENAME CONSTRAINT "school_subscriptions_school_fkey" TO "school_subscriptions_schoolId_fkey";

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardian_links" ADD CONSTRAINT "student_guardian_links_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardian_links" ADD CONSTRAINT "student_guardian_links_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardian_links" ADD CONSTRAINT "student_guardian_links_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_announcements" ADD CONSTRAINT "platform_announcements_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "platform_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_runs" ADD CONSTRAINT "data_export_runs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_runs" ADD CONSTRAINT "data_export_runs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "jobs_name_dedupe_uniq" RENAME TO "jobs_name_dedupeKey_key";

-- RenameIndex
ALTER INDEX "notification_deliveries_notification_idx" RENAME TO "notification_deliveries_notificationId_idx";

-- RenameIndex
ALTER INDEX "notifications_school_created_idx" RENAME TO "notifications_schoolId_createdAt_idx";

-- RenameIndex
ALTER INDEX "notifications_severity_created_idx" RENAME TO "notifications_severity_createdAt_idx";

-- RenameIndex
ALTER INDEX "notifications_template_dedupe_uniq" RENAME TO "notifications_templateKey_dedupeKey_key";

-- RenameIndex
ALTER INDEX "notifications_user_created_idx" RENAME TO "notifications_userId_createdAt_idx";

-- RenameIndex
ALTER INDEX "platform_audit_events_actor_idx" RENAME TO "platform_audit_events_actorUserId_idx";

-- RenameIndex
ALTER INDEX "platform_audit_events_target_idx" RENAME TO "platform_audit_events_targetType_targetId_idx";

-- RenameIndex
ALTER INDEX "school_subscriptions_school_recent_idx" RENAME TO "school_subscriptions_schoolId_createdAt_idx";

-- RenameIndex
ALTER INDEX "sessions_user_created_idx" RENAME TO "sessions_userId_createdAt_idx";
