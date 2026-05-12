# Failure Handling Guidelines

_Last updated: 2026-07-18 — Phase RELIABILITY Part 8._
_Audience: anyone writing backend handlers or frontend mutation flows._

How we want errors to feel to the operator. Concrete patterns from
this codebase.

## 1. Every high-risk failure must say three things

1. **What happened.** "Exam is locked." "Student is archived."
   "Active session ended."
2. **Why.** "Marks edits require an unlock first." "Restore the
   record before editing." "Promote to the next session."
3. **What to do next.** A specific action the operator can take from
   where they are.

Bad copy:

```
500: Internal Server Error
```

Good copy (from `ExamService.assertEditable`):

```json
{
  "statusCode": 423,
  "message": "This exam is locked. Marks cannot be edited until an admin unlocks it.",
  "examId": "...",
  "locked": true,
  "lockedAt": "2026-04-12T..."
}
```

The three pieces are interleaved naturally: what (locked), why
(can't edit), next step (admin unlock).

## 2. HTTP status code conventions

| Code | When | Example |
| --- | --- | --- |
| 400 | Malformed payload (DTO validation) | Missing required field |
| 401 | No / expired token | `lib/api.ts` redirects |
| 403 | Authenticated but not authorized | Non-admin hits admin route |
| 404 | Cross-tenant id OR genuine absence | Always 404 for tenant isolation |
| 409 | Wrong lifecycle state (archived / ended / draft when published required) | Edit on archived student |
| 410 | Permanently gone (tenant ARCHIVED) | Suspended school 90+ days |
| 422 | Validation passed but business rule blocks | Promotion preview blockers |
| 423 | Locked (RFC 4918) | Marks edits on locked exam |
| 429 | Rate-limited | Throttler buckets |
| 500 | Unexpected — bug | Investigate, don't paper over |

Rules:

- **403 vs 404**: when in doubt, return 404. 403 leaks "this id
  exists somewhere." See `common/multi-tenant/assert-school-scope.ts`.
- **409 vs 423**: 423 specifically for marks-lock (a reversible
  same-row "Unlock" action). 409 for everything else (archive,
  ended session, draft state).

## 3. Body shape for non-200 responses

Every non-2xx response goes through `common/filters/http-exception
.filter.ts`. The shape is consistent:

```json
{
  "statusCode": 423,
  "message": "Human-readable copy.",
  "additionalContext": "..."
}
```

Additional structured fields (`examId`, `archivedAt`, `lockedAt`)
are encouraged when the client needs them to render a useful UI.
The frontend's `ApiError` class in `lib/api.ts` exposes both
`.status` and the parsed body so consumers can branch.

## 4. Audit emits MUST NOT block the response

`PlatformAuditService.record` swallows all errors and logs them via
NestJS Logger. **Never** wrap it in a try/catch that rethrows. The
audit log is best-effort by design — a failed audit row is a
security signal, not a user-facing failure.

```ts
// ✅ Correct
await this.audit.record({ ... }); // swallows on error

// ❌ Wrong — turns soft-fail into hard-fail
try {
  await this.audit.record({ ... });
} catch (e) {
  throw new InternalServerErrorException('Audit failed');
}
```

## 5. Optimistic UI must always reconcile

Pattern from `students/page.tsx` archive flow:

1. Click → row exits animation, removed from local state, toast with
   undo button (5s window).
2. After 5s → fire the actual API call.
3. If API succeeds → invalidate the cache to bring the canonical
   state in.
4. If API fails → put the row back, show a destructive toast with
   the error message.

Rules:

- **Always have a reconcile-on-fail path.** Without it, the optimistic
  state drifts forever after a failure.
- **The error toast must carry the failure message**, not just
  "Operation failed." Read the `ApiError.message` from `lib/api.ts`.
- **Disable the trigger button while the mutation is pending** to
  prevent double-fires.

## 6. Partial-success workflows

Some operations succeed for N of M items. Examples:

- `student.service.ts:bulkCreate` — returns
  `{ successCount, failed: [{ rowIndex, reason }] }`.
- `promotion.service.ts:run` — returns
  `{ counts: { promoted, retained, left, total } }`.

Rules:

- **Do not throw on partial success.** Return the structured result
  with both halves.
- **The UI must surface both halves.** Toast for the success count;
  table for the per-row failures with their reasons. See
  `ImportStudentsDialog` for the working pattern.
- **The audit emit captures the full structured result**, including
  failure counts.

## 7. Retry loops are forbidden on the frontend

Don't write `while (attempt < n) try fetch() catch wait()`. Use
the React Query mutation `onError` + a manual Retry button.
Server-side P2034 retry happens inside `txWithRetry` and never
bubbles a retryable error to the frontend.

The api layer (`lib/api.ts`) DOES retry 429 responses with
exponential backoff and jitter — that's the **only** automatic
retry on the frontend. Anything else needs operator approval.

## 8. Silent failures are the worst kind

Patterns that produce silent failures and must be avoided:

- **`.catch(() => {})`** without a comment explaining why.
- **Mutations whose `onError` doesn't surface a toast.**
- **Background sync that drops failed jobs without logging.**
- **Optimistic UI that doesn't reconcile.**

If a failure is intentionally silent (e.g. analytics ping), the
catch block needs a comment that explicitly says "soft-fail by
design — this is telemetry."

## 9. The remediation index — what to say when

Common failure modes and the exact remediation copy:

| Failure | Code | Copy |
| --- | --- | --- |
| Archived student edit | 409 | "Student "{name}" is archived. Restore it before editing." |
| Locked exam marks edit | 423 | "This exam is locked. Marks cannot be edited until an admin unlocks it." |
| Ended session write | 409 | "Session "{name}" ended on {date}. Promote to the next session before writing." |
| No active session for new exam | 409 | "No active academic session. Create or activate one in Settings → Sessions." |
| Promotion blocker | 422 | "{N} students cannot be promoted: {reasons}. Resolve blockers and re-run preview." |
| Multiple active sessions | 500 | "Multiple active sessions detected. Contact platform operations." |
| Duplicate symbol number | 409 | "That symbol number is already assigned to another student in this school." |
| Cross-tenant id | 404 | "Resource not found." (uniform copy; never leaks existence) |
| Backend rate-limited | 429 | "Slow down — too many requests. Retrying automatically." |

Copy your message FROM this table. Adding a new failure mode? Add
the row here first.

## 10. PR review checklist for failure handling

- [ ] Every new throw has a human-readable message naming the
      what / why / next-step.
- [ ] Every audit emit is awaited but its error is swallowed.
- [ ] Frontend mutations have `onError` that surfaces a toast.
- [ ] Optimistic state has a reconcile path on failure.
- [ ] No `.catch(() => {})` without a justification comment.
- [ ] Status code follows the table in section 2.
- [ ] Body shape matches `http-exception.filter.ts`.

Tick every box, or write down why one doesn't apply.
