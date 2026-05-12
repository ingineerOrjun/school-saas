# Failure Copy Reference

_Last updated: 2026-07-21 — Phase RELIABILITY-III Part 8._
_Audience: anyone writing new backend throws or frontend error toasts._

This is the canonical text for every high-risk failure the platform
produces. Engineers writing new error paths must match these strings
verbatim or extend this reference with a new entry.

Operators reading this document can understand what each message
means before encountering it.

Pairs with `OPERATOR_FAILURE_SCENARIOS.md` (the longer-form
remediation guide). This file is the **string source of truth**;
that file is the **remediation reasoning**.

## Format

| ID | HTTP | Domain | Message |

- **ID** stable identifier — append-only.
- **HTTP** the status code returned.
- **Domain** the affected module.
- **Message** the exact string. Curly-brace placeholders are filled
  at runtime; everything else is verbatim.

---

## 1. Archive lifecycle

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-ARCH-01 | 409 | student.service | `This student is archived. Restore the record before editing.` |
| FC-ARCH-02 | 409 | exam.service | `This exam is archived. Restore it before editing.` |
| FC-ARCH-03 | 409 | exam.service (assertEditable) | `This exam is archived. Restore it before editing marks.` |
| FC-ARCH-04 | 409 | exam.service (publish) | `This exam is archived. Restore it before publishing.` |
| FC-ARCH-05 | 422 | promotion-preview.service | `{firstName} {lastName} is archived. Restore them before including in a promotion run.` |
| FC-ARCH-06 | 409 | common/assert-mutable.ts | `{entity} is archived. Restore it before editing.` |

All six follow the same shape: **what** (archived), **why** (write
rejected), **next step** (Restore). The frontend renders the matching
ArchivedBadge so the operator sees the state before attempting.

## 2. Marks lock

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-LOCK-01 | 423 | exam.service (assertEditable) | `This exam is locked. Marks cannot be edited until an admin unlocks it.` |
| FC-LOCK-02 | 423 | common/assert-mutable.ts | `{entity} "{label}" is locked. Marks cannot be edited until an admin unlocks it.` |

`LockedBadge` on the marksheet header + ExamStateBanner on the
marks-entry page warn the operator before the click.

## 3. Academic sessions

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-SESS-01 | 400 | promotion.service | `No active academic session. Create or activate a session in /settings/sessions before running promotion.` |
| FC-SESS-02 | 409 | academic-session.service (remove active) | `Cannot delete "{name}" while it is the active session. Activate a different session first, then retry.` |
| FC-SESS-03 | 400 | promotion.service | `Active session must be locked before running promotion. Lock it from /settings/sessions first.` |
| FC-SESS-04 | 400 | academic-session.service | `startDate must be before endDate.` |
| FC-SESS-05 | 400 | promotion.service (nextSession) | `nextSession startDate must be before endDate.` |

## 4. Student identity

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-STUD-01 | 409 | student.service (P2002 symbolNumber) | `That symbol number is already assigned to another student in this school.` |
| FC-STUD-02 | 409 | student.service (P2002 userId) | `That user is already linked to another student.` |
| FC-STUD-03 | 409 | student.service (P2002 fallback) | `This change conflicts with an existing record. Open /audit/recent to see what else changed recently, then retry with corrected values.` |
| FC-STUD-04 | (bulk) | student.service (regno collision in bulk) | `Two simultaneous imports tried to claim the same registration number. Wait 5 seconds and re-submit this batch — the retry will succeed.` |
| FC-STUD-05 | (bulk) | student.service (symbolNumber collision in bulk) | `A symbol number in this batch collides with an existing student in your school. Edit the CSV to remove or replace the duplicate symbol number, then re-submit.` |
| FC-STUD-06 | (bulk) | student.service (generic rollback) | `No rows were imported — the transaction rolled back. Check your CSV for invalid dates, blank required fields, or unknown classes, then re-submit.` |

The bulk-import per-row failure reasons are reported in the
`BulkCreateResult.failed[]` array; the frontend renders them in the
import-result table.

## 5. Promotion

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-PROM-01 | 400 | promotion.service | `The promotion payload lists the same student more than once. Re-run the preview, fix the duplicate, then submit again.` |
| FC-PROM-02 | (preview) | promotion-preview.service | `{firstName} {lastName} is archived. Restore them before including in a promotion run.` |
| FC-PROM-03 | (preview) | promotion-preview.service | `{N} student(s) have unpublished exams in the current session. Publish their marks or mark them as Held Back before promoting.` |
| FC-PROM-04 | (preview) | promotion-preview.service | `{firstName} {lastName} would land in a class that doesn't exist in the next session.` |

Preview blockers surface in the preview-report UI before run-time.
Run-time rejections refer back to "re-run the preview" for clarity.

## 6. Financial

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-FEE-01 | 409 | fees.service (duplicate refund) | `This payment has already been refunded.` |
| FC-FEE-02 | 400 | fees.service | `Refund amount must be positive.` |
| FC-FEE-03 | 400 | fees.service | `Refund amount cannot exceed the original payment.` |
| FC-FEE-04 | 404 | fees.service | `Payment not found.` |
| FC-FEE-05 | 409 | fees.service | `Cannot refund a refund slip.` |

Refunds are append-only (a refund creates a new negative-amount
Payment row; the source flips to REFUNDED). The receipt UI shows
the Refund slip pill so operators see the state inline.

## 7. Integrity check (informational, not throws)

| ID | Severity | Code | Message in IntegrityReport |
| --- | --- | --- | --- |
| FC-INT-01 | error | `STUDENT_DUPLICATE_REGNO` | `Duplicate registration numbers detected.` + remediation `Reissue affected students from the Students page.` |
| FC-INT-02 | error | `STUDENT_DUPLICATE_SYMBOL` | `Duplicate symbol numbers detected.` + remediation `Edit the affected students to assign unique symbol numbers.` |
| FC-INT-03 | error | `MULTIPLE_ACTIVE_SESSIONS` | `Multiple academic sessions are flagged active. Schema invariant violated.` + remediation `Contact platform operations — this should not be possible under the partial unique index.` |
| FC-INT-04 | warning | `NO_ACTIVE_SESSION` | `No active academic session.` + remediation `Create or activate a session in Settings → Sessions. Most write paths require one.` |
| FC-INT-05 | warning | `EXAM_MISSING_SESSION` | `Exams not attached to any academic session. Legacy state from before session support.` + remediation `Open each exam in /exams and re-save it under the active session, or archive if obsolete.` |

The System Health page renders these inline with severity chips. No
text is auto-translated — operators see the same English everywhere.

## 8. Throttling + retry

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-TX-01 | 429 | global throttler | `Slow down — too many requests.` |
| FC-TX-02 | 500 | tx-retry (exhaustion logged, not surfaced to operator) | logged: `retries exhausted for "{label}". Consider widening contention windows or capping operator parallelism.` |
| FC-TX-03 | 401 | api.ts | `Your session has expired. Please log in again.` |

`FC-TX-02` is operator-internal — the user sees a generic
"Retries exhausted. Please wait a moment and try again." in the
frontend toast (see frontend handler). The detailed logged form is
for the operations cockpit.

## 9. Authentication

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-AUTH-01 | 401 | auth.service | `Invalid credentials.` |
| FC-AUTH-02 | 403 | auth.service (suspended school) | `This school is suspended. Contact your administrator.` |
| FC-AUTH-03 | 410 | auth.service (archived school) | `This school is no longer active.` |
| FC-AUTH-04 | 401 | auth.service (bad schoolCode) | `Invalid school code.` |

## 10. Tenant isolation

| ID | HTTP | Domain | Message |
| --- | --- | --- | --- |
| FC-TENANT-01 | 404 | assert-school-scope.ts | `{entity} not found.` |

Always 404, NEVER 403. This is the uniform-copy contract for
tenant isolation — leaking "this exists in another tenant" via a 403
would enable cross-tenant UUID enumeration.

## How to add a new entry

1. Pick the next available ID in the relevant section (append-only).
2. Verify the exact string matches your `throw new …Exception(...)`
   call.
3. If the string drifts between calls (e.g. for templated copy), use
   `{placeholder}` notation here and ensure the runtime fill matches.
4. Add a corresponding scenario to `OPERATOR_FAILURE_SCENARIOS.md`
   with the remediation reasoning.
5. If the failure is surfaced via badge instead of throw, document
   the surface in `OPERATOR_TRUST_SURFACES.md` too.

## What to AVOID

These patterns appear in older code and are being phased out:

- `'Conflict with an existing record.'` — too vague. Replaced by
  FC-STUD-03 which points at /audit/recent.
- `'Database transaction failed.'` — leaks implementation detail.
  Replaced by FC-STUD-06 which guides CSV remediation.
- `'Operation failed.'` — meaningless. Never use this string.
- Prisma error codes in user-facing strings — leak internal detail.
  Translate to operator language first.
- Stack traces in toast messages — never. Stack traces go to the
  operations log; toasts get human copy.

## PR review checklist

- [ ] New throw matches an existing ID, OR a new ID is added here.
- [ ] Message has what/why/next-step.
- [ ] No Prisma error codes or stack-trace fragments leak into the
      message.
- [ ] Frontend handler renders the backend message verbatim (no
      override unless the override is documented here).
- [ ] Pairing entry exists in `OPERATOR_FAILURE_SCENARIOS.md`.
