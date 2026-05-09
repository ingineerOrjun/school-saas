-- ---------------------------------------------------------------------------
-- Phase 17 follow-up — Sessions.
--
-- Per-token tracking so users can list + selectively revoke their
-- active sessions. Distinct from the existing `users.tokensValidAfter`
-- watermark:
--
--   tokensValidAfter — kills EVERY token for a user. Single knob,
--                      operator-grade ("compromised account, log
--                      everything out"). Phase 9.
--   sessions table   — tracks each token individually. User-grade
--                      ("I lost my phone, log out THAT one").
--                      Phase 17 follow-up.
--
-- Both mechanisms coexist. JwtStrategy checks both: a token is
-- valid only if its session row is non-revoked AND its iat is not
-- below the watermark.
--
-- Backwards compatibility:
--   Tokens issued BEFORE this migration carry no `sid` claim. We
--   treat them as "implicit session" — they fall through to the
--   watermark check alone. Once those tokens expire (default 7d),
--   every active token has a sid.
--
-- Activity tracking:
--   `lastActiveAt` updates from JwtStrategy on each authenticated
--   request, but throttled to once per minute per session to avoid
--   write amplification.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sessions" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        UUID NOT NULL,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT now(),
  "lastActiveAt"  TIMESTAMP NOT NULL DEFAULT now(),
  -- Best-effort capture at session creation. Snapshotted, not live.
  "ip"            TEXT,
  "userAgent"     TEXT,
  -- Null until the user revokes (or until logout / admin force-logout
  -- explicitly targets this session). Once set, the strategy rejects
  -- the token; the row stays for audit history.
  "revokedAt"     TIMESTAMP,
  -- Free-form reason captured at revoke time ("user logout",
  -- "admin revoked", "rotated by security event").
  "revokedReason" TEXT,

  CONSTRAINT "sessions_user_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE
);

-- The strategy's per-request lookup is by primary key, already
-- covered. These indexes serve the listing + revocation paths.
CREATE INDEX IF NOT EXISTS "sessions_user_active_idx"
  ON "sessions" ("userId", "lastActiveAt" DESC)
  WHERE "revokedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "sessions_user_created_idx"
  ON "sessions" ("userId", "createdAt" DESC);
