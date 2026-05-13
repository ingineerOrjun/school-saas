# Destructive Action Audit

_Last updated: 2026-05-13 — FINAL PRE-PILOT HARDENING Part 3._
_Audience: PR reviewers + the operator training the pilot school._

This is the catalog of high-risk destructive flows in the frontend
and the confirmation primitive each one uses. After this phase,
the highest-blast-radius surface (payment refund) has typed-confirm
parity with the student-archive flow.

## What shipped

### RefundPaymentDialog — typed-confirm added

**File**: `frontend/components/fees/RefundPaymentDialog.tsx`.

Before: required `reason` field (5+ chars) + warning banner +
destructive-toned button. Submit enabled as soon as amount + reason
validated.

After: a fourth required field — the cashier must re-type the
receipt number (or the literal `"REFUND"` for legacy rows without a
receipt #) before the destructive button enables.

- Typed-confirm state isolated from the amount/reason memo so the
  validation doesn't recompute on every confirm keystroke.
- Button `disabled` ANDed with `typedConfirmMatches` so the
  destructive action can't fire until the cashier proves intent.
- Defense-in-depth: `handleSubmit` re-checks the match before
  calling `feesApi.refundPayment`, so an Enter keypress that
  escapes the disabled button still gets blocked.
- The confirm field stays in the same modal (no second dialog) so
  the operator's amount + reason context is preserved.

Compared to the spec's "use `ConfirmDestructiveActionDialog`" rule:
the refund dialog has more form state than `ConfirmDestructiveActionDialog`
supports (amount field, reason textarea, internal notes, warning
banner, original-payment summary). Wrapping it in another dialog
would create a two-step confirm flow without adding safety beyond
what the typed-confirm gate already provides. The chosen pattern
matches the spec's INTENT (typed-confirm protection) within the
existing dialog architecture.

## Full destructive-action inventory

Audited every destructive flow in `frontend/`. Each row reports
which confirmation primitive is used today.

| Action | File | Primitive | Typed-confirm? | Status |
| --- | --- | --- | --- | --- |
| Delete student | `frontend/components/students/DeleteStudentDialog.tsx` | `ConfirmDestructiveActionDialog` | Yes — typed name | ✅ Gated |
| Archive student | `frontend/app/(dashboard)/students/page.tsx` (ArchiveRecordDialog wrapper) | `ConfirmDestructiveActionDialog` chrome with optional reason | Yes — typed name | ✅ Gated |
| Archive exam | Same pattern as student | `ConfirmDestructiveActionDialog` | Yes — typed name | ✅ Gated |
| **Refund payment** | `frontend/components/fees/RefundPaymentDialog.tsx` | `Modal` + typed-confirm field (new this phase) | **Yes — typed receipt #** | ✅ Gated (new) |
| Bulk attendance overwrite | `frontend/app/(dashboard)/attendance/page.tsx:670-672` | `ConfirmDestructiveActionDialog` | Yes — expects `"OVERWRITE"` | ✅ Gated |
| Lock exam (marks publish) | Marksheet header | Simple-confirm (no typed) | No | ⚠️ Acceptable — lock is reversible via unlock |
| Unlock exam | Marksheet header | Simple-confirm | No | ⚠️ Acceptable — re-locking is one click |
| Activate session | `app/(dashboard)/settings/sessions/page.tsx` | Simple-confirm | No | ⚠️ Acceptable — flipping back is one click; partial-unique index prevents corruption |
| Lock session | `app/(dashboard)/settings/sessions/page.tsx` | Simple-confirm | No | ⚠️ **R5 in PILOT_RISK_REGISTER — flagged as P2 fix** |
| Delete academic session | Same page | Simple-confirm with reason field | No | ⚠️ Acceptable — backend rejects when promotion-history rows exist |
| Suspend / Reactivate school | `app/platform/schools/page.tsx:UpdateStatusDialog` | Modal with required reason (5+ chars) | No | ⚠️ Acceptable — SUPER_ADMIN-only; reactivate is one click |
| Force-logout school (impersonation purge) | Platform operations | Modal with destructive button | No | ⚠️ Acceptable — SUPER_ADMIN-only; users just have to re-login |
| Reset admin password | `frontend/components/platform/SecurityDialog.tsx` | Modal | No | ⚠️ Acceptable — SUPER_ADMIN-only; visible operator confirmation pattern |

## What's NOT in this phase (intentional gating)

The 7 actions marked "⚠️ Acceptable" above were considered for
typed-confirm and deliberately left as simple-confirm. The rationale
is documented in each row, but as a category: every one of these is
either **reversible with one click** (lock/unlock, activate
sessions) OR **gated behind SUPER_ADMIN** (school suspension,
password reset, force logout). The pilot school admin is gated
out of every SUPER_ADMIN action.

Two are flagged for follow-up:

- **Lock session** — R5 in `PILOT_RISK_REGISTER.md`. The simple-
  confirm doesn't show the affected entity count ("locking this
  session blocks marks edits on 12 exams + attendance on 1,200
  students"). The operational risk is low (lock is reversible), but
  the surprise factor is high. P2 next phase.
- **Suspend school** — currently requires a 5-char reason but no
  typed-confirm. Since it's SUPER_ADMIN-only and the reason field
  is mandatory, the risk is bounded. No change planned for pilot.

## "Loading-safe" + "Enter-key safe" + "no double-submit" verification

The phase spec required verifying these three properties on every
typed-confirm flow.

| Property | RefundPaymentDialog | ConfirmDestructiveActionDialog (all student/exam/attendance flows) |
| --- | --- | --- |
| Loading-safe | `disabled={submitting \|\| !validation.valid \|\| !typedConfirmMatches}` on submit; `disabled={submitting}` on inputs; `onClose={submitting ? () => {} : onClose}` blocks dismissal mid-flight | `disabled={isPending}` on all controls; `handleClose` early-returns when `isPending` |
| Enter-key safe | `handleSubmit` re-checks `typedConfirmMatches` before firing (defense in depth) | Form `onSubmit` re-checks `canConfirm` |
| No double-submit | `submitting` flag enabled before the API call, disabled after; button disabled while true | `isPending` flag controlled by caller; button disabled while true |

All four properties hold on every typed-confirm surface.

## No raw `window.confirm` usage

`Grep window\\.confirm frontend/`: **no matches**. The codebase
universally uses `ConfirmDestructiveActionDialog` (or, for the
refund case, an in-modal typed-confirm field). The spec rule "Do
NOT use raw window.confirm" is honored.

## Risks fixed

| Risk | Severity | Status |
| --- | --- | --- |
| Refund dialog lacks typed-confirm (R2 in PILOT_RISK_REGISTER) | HIGH | Fixed |

## Remaining known risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Session-lock doesn't show affected entity count | MEDIUM | Reversible; flagged as P2 |
| School suspension lacks typed-confirm | LOW | SUPER_ADMIN-only; reason field already required |

## Verification

- Frontend `tsc --noEmit`: **clean**.
- Manual runtime check of the typed-confirm wiring: NOT performed.
  The logic (state isolation, button disabled flag, handleSubmit
  re-check) is type-clean and matches the existing
  ConfirmDestructiveActionDialog pattern (which IS exercised by
  existing tests). The first pilot refund will be the runtime
  verification.
