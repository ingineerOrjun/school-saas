# Promotion Governance

_Last updated: 2026-07-15 — Phase ACADEMIC TRANSITION SAFETY Part 3._

This document defines the rules that govern academic year-end
promotion in Scholaris. It pairs with:

- [`retention-policy.md`](./retention-policy.md) — explains why
  archived rows survive a promotion, and why hard-delete is not
  exposed for the high-risk entities a promotion touches.
- `PromotionPreviewService` — the implementation of the rule set
  below. Every rule in §2 maps to a `PromotionIssueCode`.

## 1. Goals

1. **Promotion mistakes are preventable.** No "oh no" moment after
   the academic year has been rolled over.
2. **Every run is auditable.** `PROMOTION_PREVIEWED` and
   `PROMOTION_EXECUTED` audit rows pair with `StudentAcademicRecord`
   snapshots so the platform can answer "who, what, when, from-where,
   to-where" for any past year.
3. **Recovery is possible at every step.** Until `/promotion/run`
   fires, nothing is committed; if a run fails mid-transaction,
   nothing is committed.

## 2. Promotion rules (enforced by `PromotionPreviewService`)

| Rule | Severity | Code |
| --- | --- | --- |
| Active academic session must exist | error | `NO_ACTIVE_SESSION` |
| Active session must be locked first | error | `SESSION_NOT_LOCKED` |
| Current session must not have already ended | warning | `SESSION_ENDED` |
| Next-session name must be unique per school | error | `DUPLICATE_SESSION_NAME` |
| Next-session date range must be valid (start < end) | error | `INVALID_DATE_RANGE` |
| Next session should not start before current ends | warning | `OVERLAPPING_SESSION_DATES` |
| Each studentId must appear at most once in payload | error | `DUPLICATE_STUDENT_IN_PAYLOAD` |
| `PROMOTED` entries must include `nextClassId` | error | `PROMOTED_MISSING_NEXT_CLASS` |
| `nextClassId` must reference a class in this school | error | `NEXT_CLASS_NOT_FOUND` |
| `nextClassId` must not be archived | error | `NEXT_CLASS_ARCHIVED` |
| `nextSectionId` must belong to `nextClassId` | error | `NEXT_SECTION_MISMATCH` |
| Each studentId must exist in this school | error | `STUDENT_NOT_FOUND` |
| Students must NOT be currently archived | error | `STUDENT_ARCHIVED` |
| Students must have a current class to snapshot | error | `STUDENT_NO_CURRENT_CLASS` |
| Each student must not already be in source session's history | error | `STUDENT_ALREADY_PROMOTED` |
| Exams with unpublished results in source session | warning | `UNPUBLISHED_RESULTS_IN_SOURCE` |
| Locked exams in source session (informational) | warning | `LOCKED_EXAMS_IN_SOURCE` |

**Severity contract.** A code never changes severity at runtime. If
`STUDENT_ARCHIVED` is an error today, it is an error tomorrow. Tests
assert exact codes; the UI maps codes to localized copy.

## 3. The two-call flow

The frontend invokes promotion as a two-step contract:

1. **`POST /promotion/preview`** — dry-run validation. Returns
   `PromotionValidationResult`. Audited as `PROMOTION_PREVIEWED`.
   Never writes.
2. **`POST /promotion/run`** — execution. Audited as
   `PROMOTION_EXECUTED`. Stamps `promotedById`, `nextClassId`,
   `nextSectionId` on every `StudentAcademicRecord`.

`/promotion/run` re-applies the same precondition checks that the
preview does plus archived-student rejection — so a UI that skips
the preview cannot smuggle invalid rows past the safety net. The
DEV-mode log warns when this happens (Phase ACADEMIC TRANSITION
SAFETY Part 8) so reviewers can chase the offending caller.

## 4. Result publication states (Part 4)

Exams now carry an explicit three-state publication model:

| State | `locked` | `publishedAt` | Operator meaning |
| --- | --- | --- | --- |
| Draft | false | null | Editable; not visible to parents |
| Published | false | set | Editable; visible to parents |
| Locked | true | either | Immutable until explicit unlock |

State transitions:

- Publish → `MARKS_PUBLISHED` audit.
- Unpublish → `MARKS_UNPUBLISHED` audit. Rejected if locked (409).
- Lock → `MARKS_LOCKED` audit. Allowed from Draft or Published.
- Unlock → `MARKS_UNLOCKED` audit.

The `ExamStateBadge` component picks the right pill automatically;
the rule "locked dominates published" is enforced both server-side
(via `assertEditable`) and client-side (via `deriveExamState`).

## 5. Session transition safety (Part 5)

`AcademicSessionService` enforces:

- Cannot delete the active session — `ConflictException`.
- Cannot delete a session that has `StudentAcademicRecord` rows —
  history is the academic record of record.
- Multiple active sessions is structurally impossible (partial
  unique index + transactional `setActive`).
- Writes targeting a locked or ended session are rejected via
  `assertSessionWritable`.

## 6. Audit-ready execution payload (Part 3)

Every executed run lands two artifacts:

1. A `PROMOTION_EXECUTED` row in `platform_audit_events` with
   `after.fromSessionId`, `after.toSessionId`, `after.counts`, plus
   the actor's IP + user-agent.
2. One `StudentAcademicRecord` per entry with
   `(classId, sessionId, status, nextClassId, nextSectionId,
    promotedById)`. These rows are immutable in practice — there
   is no service-layer update path. The audit log + the SAR table
   together reconstruct the full history.

## 7. Failure UX (Part 7)

Every blocker code carries:

- `message` — the default English sentence the backend returns.
- `PROMOTION_ISSUE_COPY[code]` — UI-side override with `title` +
  `remediation` step.

Failure surfaces avoid generic "Operation failed" copy. Examples:

- "12 students could not be promoted" — derived from `counts.blocked`.
- "Promotion blocked because destination class is archived" —
  `NEXT_CLASS_ARCHIVED` issue.
- "Results already locked" — `LOCKED_EXAMS_IN_SOURCE` warning.

## 8. Future work (explicitly deferred)

- **Automatic promotion scheduler.** Not in this phase. The
  `PromotionPreviewService` is built for future re-use here.
- **Per-student promotion comments.** A `notes` field on
  `StudentAcademicRecord` is the obvious next step but not in scope.
- **Multi-active-session support.** Structurally blocked today and
  no plans to relax.
- **Promotion rollback.** Today, the only way to "undo" a promotion
  is a backup restore (see retention-policy.md §6). A targeted
  rollback workflow is a future phase.
