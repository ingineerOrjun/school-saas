-- ---------------------------------------------------------------------------
-- Phase 9 — Security controls.
--
-- Two complementary mechanisms ship together:
--
--   1. Force logout (session invalidation).
--      A new `tokensValidAfter` timestamp on the User row. The JWT
--      strategy compares `payload.iat * 1000` against this value;
--      when `iat < tokensValidAfter`, the token is rejected as
--      expired even if its built-in `exp` is still in the future.
--      Setting `tokensValidAfter = now()` on a row instantly
--      invalidates every JWT issued before that moment for that user.
--
--      Bulk school-wide force-logout is just `UPDATE users SET
--      tokensValidAfter = now() WHERE "schoolId" = $1` — no
--      separate revocation table to maintain.
--
--      Default NULL means "no revocation point" → tokens are
--      accepted as long as `exp` allows. Existing rows on rollout
--      keep working unchanged.
--
--   2. Admin password reset.
--      No schema change. The platform endpoint generates a strong
--      random temporary password, hashes it, writes it via the
--      existing `password` column, and sets `tokensValidAfter` on
--      the same row to log the user out of any open sessions.
--      The plaintext password is returned ONCE in the API response
--      so the platform owner can hand it off out-of-band.
--
-- Three new audit actions for the audit-log taxonomy:
--   • USER_FORCE_LOGOUT      — single user invalidated.
--   • SCHOOL_FORCE_LOGOUT    — every user at a school invalidated.
--   • ADMIN_PASSWORD_RESET   — password rewritten by SUPER_ADMIN.
-- ---------------------------------------------------------------------------

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tokensValidAfter" TIMESTAMP;

-- The JWT strategy reads `tokensValidAfter` once per request after
-- the user lookup; the existing `users_pkey` covers that path.
-- No additional index needed.

ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'USER_FORCE_LOGOUT';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'SCHOOL_FORCE_LOGOUT';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_PASSWORD_RESET';
