import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

// ============================================================================
// Mutation-state assertion helpers — Phase PLATFORM STABILIZATION Part 1.
//
// Pairs with `assert-school-scope.ts`. Where that file enforces tenant
// boundaries, these helpers enforce LIFECYCLE state — "this row exists
// but is in a state that rejects writes."
//
// Why centralize:
//   • Every entity that grew an `archivedAt` (Student, Exam) or a
//     `locked` flag now needs the same reject pattern. Repeating it in
//     three services drifts the error copy.
//   • Standardizes 409 / 423 status codes so the frontend can match
//     on code, not on message.
//   • Includes dev-only logging hooks for suspicious access attempts
//     (e.g. a write that bypassed `assertNotArchived` and was caught
//     downstream).
//
// Status codes used here:
//   • 409 CONFLICT — wrong lifecycle state (archived, draft when
//     published required, ended session, etc.). Same code the service
//     layer already uses elsewhere.
//   • 423 LOCKED  — RFC 4918. Used specifically for the marks lock,
//     consistent with `ExamService.assertEditable`.
//
// Production overhead:
//   • One conditional throw per call site. No allocations on the
//     happy path beyond what NestJS already does.
//   • Dev warnings gated on `NODE_ENV !== 'production'`.
// ============================================================================

/**
 * Reject if `archivedAt` is set. Standard "Restore the record first"
 * remediation is baked in so every callsite returns the same copy.
 *
 * Throws `ConflictException` (409) — distinct from the 423 used for
 * exam locks, because archived rows are reversible via a Restore
 * action, not by a same-row Unlock.
 */
export function assertNotArchived(
  row: { archivedAt: Date | string | null } | null | undefined,
  opts: { entity: string; entityLabel?: string },
): void {
  if (row && row.archivedAt) {
    const subject = opts.entityLabel
      ? `${opts.entity} "${opts.entityLabel}"`
      : opts.entity;
    throw new ConflictException(
      `${subject} is archived. Restore it before editing.`,
    );
  }
}

/**
 * Reject if an exam (or any lockable record) is locked. Mirrors the
 * shape of `ExamService.assertEditable` so existing call sites can
 * gradually migrate.
 *
 * Throws HTTP 423 LOCKED with a structured body so the frontend can
 * distinguish "needs unlock" from generic 4xx.
 */
export function assertNotLocked(
  row: {
    locked?: boolean | null;
    lockedAt?: Date | string | null;
  } | null | undefined,
  opts: { entity: string; entityId?: string; entityLabel?: string },
): void {
  if (row?.locked) {
    const subject = opts.entityLabel
      ? `${opts.entity} "${opts.entityLabel}"`
      : opts.entity;
    throw new HttpException(
      {
        statusCode: HttpStatus.LOCKED,
        message: `${subject} is locked. Marks cannot be edited until an admin unlocks it.`,
        entityId: opts.entityId,
        locked: true,
        lockedAt: row.lockedAt ?? null,
      },
      HttpStatus.LOCKED,
    );
  }
}

/**
 * Reject if a write targets a session that has ended. Pair with
 * `AcademicSessionService.assertSessionWritable` when the caller has
 * the row already; otherwise prefer the service method.
 */
export function assertSessionNotEnded(
  session:
    | { name: string; endDate: Date | string }
    | null
    | undefined,
): void {
  if (!session) return;
  const end =
    typeof session.endDate === 'string'
      ? new Date(session.endDate)
      : session.endDate;
  if (new Date() > end) {
    throw new ConflictException(
      `Session "${session.name}" ended on ${end
        .toISOString()
        .slice(0, 10)}. Promote to the next session before writing.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Suspicious-access logging — DEV ONLY, zero production overhead.
//
// Wraps a NestJS Logger.warn behind a NODE_ENV check. Use to flag
// situations that aren't quite errors but indicate a misuse pattern:
//
//   • a service called with a frontend-supplied schoolId being
//     ignored in favor of the JWT-derived one
//   • a defense-in-depth catch fires when the upstream guard should
//     have rejected first
//   • bulk operations that don't carry an actor
//
// In production this is a no-op so it costs nothing.
// ---------------------------------------------------------------------------

const _suspiciousLogger = new Logger('SuspiciousAccess');

export function devWarnSuspicious(
  message: string,
  context?: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === 'production') return;
  const suffix = context ? ` ${JSON.stringify(context)}` : '';
  _suspiciousLogger.warn(`${message}${suffix}`);
}

/**
 * Helper for the very-common "controller received schoolId but should
 * always use JWT-derived" pattern. Emits a dev-only warn if the two
 * disagree. Production: no-op.
 */
export function devWarnIfMismatchedSchoolId(
  fromBody: string | undefined,
  fromUser: string,
  endpoint: string,
): void {
  if (!fromBody || fromBody === fromUser) return;
  devWarnSuspicious(
    `Endpoint "${endpoint}" received a body-supplied schoolId that doesn't match the JWT context — ignoring.`,
    { fromBody, fromUser },
  );
}

/**
 * 403 builder with explicit remediation copy. Use instead of bare
 * `throw new ForbiddenException()` so operators see a consistent
 * "what should I do" hint.
 */
export function forbiddenWithRemediation(
  reason: string,
  remediation: string,
): ForbiddenException {
  return new ForbiddenException(
    `${reason}. ${remediation}`,
  );
}
