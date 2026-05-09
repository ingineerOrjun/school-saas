import { Role } from '@prisma/client';

/**
 * Shape of the signed JWT payload.
 *
 * Every authenticated request carries (userId, role, schoolId) — the
 * minimum needed to enforce tenant isolation and RBAC without an
 * extra DB hit.
 *
 * Phase 7 — Impersonation:
 *   When a SUPER_ADMIN impersonates a school user, the issued token
 *   carries the TARGET user's identity (so the rest of the app
 *   treats every request like a normal target-user request) PLUS
 *   the `impersonatedBy` sentinel that the audit trail and the
 *   client banner read.
 *
 *   The "real" caller is `impersonatedBy` (the SUPER_ADMIN).
 *   The "effective" caller is `userId` (the target).
 *
 *   Two practical consequences:
 *     • Every write performed during impersonation is attributed to
 *       the TARGET user in domain audit columns (createdById on
 *       payments, etc.). That's intentional — impersonation is for
 *       reproducing what the school's admin sees, not for
 *       backdating actions to the SUPER_ADMIN.
 *     • Platform-tier paths (anything under /platform) MUST reject
 *       requests where `impersonatedBy` is set — Phase 7 spec rule:
 *       "cannot impersonate another SUPER_ADMIN"; corollary, you
 *       can't use an impersonated session to access platform paths.
 */
export interface JwtPayload {
  userId: string;
  role: Role;
  schoolId: string;
  /**
   * If present, this token was issued via impersonation. Value is
   * the SUPER_ADMIN's user id. Absent on normal sign-in tokens.
   */
  impersonatedBy?: string;
  /**
   * ISO timestamp of when impersonation began. Used by the banner
   * to show "Impersonating since 12:34" and by the audit trail's
   * IMPERSONATION_ENDED row to compute session duration.
   */
  impersonationStartedAt?: string;
  /**
   * Standard JWT issued-at claim, in SECONDS since epoch. Set by
   * the `jsonwebtoken` library automatically — declared here so
   * Phase 9's `tokensValidAfter` check (in `JwtStrategy.validate`)
   * has a typed reference.
   */
  iat?: number;
  /** Standard JWT expiry claim — declared for symmetry with `iat`. */
  exp?: number;
  /**
   * Phase 17 follow-up — Session id. Present on tokens issued AFTER
   * the sessions table existed. Absent on legacy tokens — the
   * strategy treats that as "implicit session" (only the watermark
   * gates them; once they expire, every token has a sid).
   */
  sid?: string;
}
