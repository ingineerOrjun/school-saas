import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// ============================================================================
// optimistic-update — Phase FINAL-HARDENING Part 2.
//
// Adds optimistic-concurrency protection to entity updates. Pairs
// with the `updatedAt @updatedAt` column that every mutable entity
// already carries (Student, Teacher, Exam, AcademicSession, Class,
// Section as of this phase; expandable to any model that has an
// `updatedAt: DateTime` field).
//
// The pattern:
//
//   1. Operator opens the edit dialog. Frontend fetches the entity
//      (including `updatedAt`).
//   2. Operator types. Frontend POSTs the change WITH the original
//      `updatedAt` value attached.
//   3. Backend service calls `assertNotStaleAndUpdate(...)` instead
//      of `prisma.<model>.update(...)` directly.
//   4. The helper does:
//
//        UPDATE … WHERE id = $id AND "updatedAt" = $expected
//
//      via Prisma's `updateMany` (which doesn't throw P2025 on zero
//      matches — it just returns a count). Zero rows updated means
//      one of two things: the row vanished, OR another operator
//      committed a change between the GET and the POST and our
//      stamp is now stale.
//   5. On zero rows, throw 409 with a stable operator-visible
//      message that the frontend can render verbatim.
//
// Why `updateMany` instead of `update`:
//   • `update(where: { id })` accepts only unique fields in the
//     where clause. `updatedAt` is NOT unique, so it can't be passed
//     to `update`.
//   • `updateMany(where: { id, updatedAt })` accepts arbitrary
//     filters. It returns `{ count }` so we can distinguish 0 vs 1.
//   • `updateMany` does NOT return the updated row. After a
//     successful update we issue ONE follow-up read to fetch the
//     fresh row (with its new `updatedAt`).
//
// What the helper does NOT do:
//   • It does not retry on stale writes. A stale write is a
//     business-rule conflict, not a transient error — let the
//     operator decide what to do (typically: refresh + retry).
//   • It does not interact with `txWithRetry`. The two are
//     orthogonal — you can wrap a stale-aware update in a retry-
//     aware transaction by composing both.
//
// Failure copy contract (per OPERATOR_FAILURE_SCENARIOS.md):
//   "This {entity} was updated by another user. Refresh and try again."
// ============================================================================

/**
 * The minimal Prisma delegate shape we need: `updateMany({ where, data })`.
 * Every model delegate in the generated client matches this.
 */
interface UpdateManyDelegate {
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

/**
 * The same shape, for the read-after-write fetch. The `include`
 * shape is intentionally `unknown` — TypeScript can't reliably
 * narrow the per-model include type through this generic surface,
 * and the helper just forwards whatever the caller passes.
 */
interface FindUniqueDelegate {
  findUnique(args: {
    where: { id: string };
    include?: unknown;
  }): Promise<unknown>;
}

export interface OptimisticUpdateInput<TData> {
  /**
   * Human-readable entity label used in the 409 message and any
   * downstream telemetry. Example: 'Student', 'Exam'.
   */
  entity: string;
  /** The row's id. */
  id: string;
  /**
   * The `updatedAt` value the caller saw when it loaded the row.
   * If this is `null`/`undefined`, the helper treats the call as a
   * "force update" (skip the optimistic check). Callers that want
   * the protection MUST pass through the round-trip value.
   *
   * Why allow undefined: legacy callers without the round-tripped
   * value still need to work during the migration window. The
   * `OPTIMISTIC_UPDATE_REQUIRED` audit (a future addition) can
   * surface call sites still doing this.
   */
  expectedUpdatedAt: Date | string | null | undefined;
  /** The data to write. Don't include `id` here. */
  data: TData;
  /**
   * Optional include shape forwarded to the post-write `findUnique`.
   * Lets callers receive the same relation-loaded shape they'd get
   * from a regular `prisma.<model>.update({ include: … })` without
   * issuing a second service-layer call.
   */
  include?: unknown;
}

/**
 * Run an optimistic-concurrency-aware update against a Prisma
 * model delegate. On success returns the updated row. On stale
 * write throws `ConflictException` (HTTP 409) with the contracted
 * message.
 *
 *   const updated = await assertNotStaleAndUpdate(
 *     this.prisma.student,
 *     {
 *       entity: 'Student',
 *       id: studentId,
 *       expectedUpdatedAt: dto.updatedAt,
 *       data: { firstName: dto.firstName, ... },
 *     },
 *   );
 *
 * Throws `ConflictException` (status 409) when the row's
 * `updatedAt` has moved since the caller saw it OR the row no
 * longer exists. The error message is the stable contract copy.
 */
export async function assertNotStaleAndUpdate<TData>(
  delegate: UpdateManyDelegate & FindUniqueDelegate,
  input: OptimisticUpdateInput<TData>,
): Promise<unknown> {
  const where: Record<string, unknown> = { id: input.id };
  if (input.expectedUpdatedAt !== null && input.expectedUpdatedAt !== undefined) {
    const expected =
      typeof input.expectedUpdatedAt === 'string'
        ? new Date(input.expectedUpdatedAt)
        : input.expectedUpdatedAt;
    where.updatedAt = expected;
  }

  const result = await delegate.updateMany({
    where,
    data: input.data as Record<string, unknown>,
  });

  if (result.count === 0) {
    // Two indistinguishable reasons:
    //   (a) the row was deleted between read + write, OR
    //   (b) another operator updated the row (most common).
    // In both cases the right operator action is the same: refresh
    // the form, re-evaluate the change, retry. The 409 surfaces the
    // contracted message; the frontend renders it verbatim.
    throw new ConflictException(
      `This ${input.entity.toLowerCase()} was updated by another user. Refresh and try again.`,
    );
  }

  // Read-after-write to return the fresh row including the new
  // `updatedAt`. Callers that just want the count can ignore this,
  // but most edit handlers need the row (often with relations) to
  // render the form.
  return await delegate.findUnique({
    where: { id: input.id },
    ...(input.include !== undefined ? { include: input.include } : {}),
  });
}

/**
 * Convenience: pluck `updatedAt` from a known-good payload while
 * tolerating callers that omit it. Returns `undefined` (not null)
 * so it composes cleanly with the helper's `expectedUpdatedAt`.
 */
export function extractUpdatedAt(payload: unknown): Date | string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as { updatedAt?: unknown }).updatedAt;
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'string') return value;
  return undefined;
}

/**
 * Type-narrow check used in tests + audit: is the given error the
 * specific 409 thrown by `assertNotStaleAndUpdate`?
 */
export function isStaleWriteConflict(err: unknown): boolean {
  return (
    err instanceof ConflictException &&
    /updated by another user/i.test(err.message)
  );
}

// Re-export Prisma for callers that need to handle adjacent error
// codes (e.g. P2025 from a follow-up `findUnique`).
export type { Prisma };
