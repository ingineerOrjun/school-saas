# Pilot Risk Register

_Last updated: 2026-05-13 — PILOT DEPLOYMENT phase, Part 5._
_Audience: operator on call during the pilot's first month._

This is the list of things real school admins are most likely to
trip on. Each entry includes: what the operator does, what goes
wrong, why, severity, and the mitigation (training note OR a
post-launch P1 fix).

Risks are graded by **likelihood × blast radius**, not by code
complexity.

## Risk matrix

| # | Risk | Likelihood | Blast radius | Severity |
| --- | --- | --- | --- | --- |
| R1 | Cross-tab stale-write overwrites concurrent edits | HIGH | MEDIUM-HIGH | **HIGH** |
| R2 | Refund dialog lacks typed-confirm | LOW-MEDIUM | HIGH | **HIGH** |
| R3 | Terminology inconsistency (archive vs lock vs deactivate) | HIGH | LOW | **MEDIUM** |
| R4 | Mobile/tablet falls back to desktop tables | HIGH | LOW-MEDIUM | **MEDIUM** |
| R5 | Session-lock has no typed-confirm + no impact summary | LOW | HIGH | **MEDIUM** |
| R6 | Single-mark correction needs full grid reload | MEDIUM | LOW | **LOW-MEDIUM** |
| R7 | Onboarding wizard doesn't include "enroll first student" | HIGH | LOW | **LOW** |
| R8 | Attendance page lacks "last marked by X at Y" trust stamp | MEDIUM | LOW | **LOW** |
| R9 | Fee history table doesn't surface REFUNDED state clearly | MEDIUM | MEDIUM | **MEDIUM** |
| R10 | First-time admin lands on dashboard without seeded reference data | HIGH | LOW | **LOW** |

## R1 — Cross-tab stale-write (HIGH)

**Scenario**: A principal opens Student "Aaditya Sharma" in Tab 1.
Meanwhile, a class teacher opens the same student in Tab 2.

- Tab 2 changes the contact number, clicks Save → OK.
- Tab 1 changes the class assignment, clicks Save → backend accepts
  the write silently. Tab 2's contact number change is LOST.

**Why**: `EditStudentDialog.tsx` (and peer dialogs) fetch the student
via React Query but the form state is local. Backend `update()` has
no `updatedAt`-based optimistic check; the second write wins by
default. No 409 is surfaced.

**Severity**: HIGH. This is the most likely real-world failure in a
school where two admins share a roster.

**Pre-launch mitigation** (training note only):
- Train admins to refresh the page before editing.
- Document: "two operators editing the same student simultaneously
  is a known limitation."

**Post-launch fix** (P1 next phase):
- Include `updatedAt` in the edit form payload.
- Backend `update()` does conditional `where: { id, updatedAt }`.
- Frontend renders "this record changed elsewhere — refresh to see
  the latest" on P2025.

## R2 — Refund dialog lacks typed-confirm (HIGH)

**Scenario**: A cashier processes multiple refunds in a row. The
dialog requires a reason (5+ chars) and a warning banner, but the
destructive button enables on click. A fast cashier could refund the
wrong receipt.

**Why**: `RefundPaymentDialog.tsx` reuses `Modal` + `Button` directly
instead of `ConfirmDestructiveActionDialog` with typed-confirm.

**Severity**: HIGH. Cashier mistakes are financially visible — a
₹10,000 refund to the wrong student is a Monday-morning conversation.

**Pre-launch mitigation**:
- Train cashiers to read the warning banner and verify the receipt
  number BEFORE typing the reason.

**Post-launch fix** (P1 launch-week):
- Wrap the refund's destructive button in
  `ConfirmDestructiveActionDialog` with `typedConfirmation:
  { label: "Type the receipt number to confirm", expectedValue:
  payment.receiptNumber }`. Mirrors the student-archive pattern.

## R3 — Terminology inconsistency (MEDIUM)

**Scenario**: An admin sees "archive student" on one page,
"lock session" on another, and is unsure whether they mean the same
thing.

**Why** (real findings from recon):
- `Archive` (students, exams) vs `Lock` (sessions, marks) vs no
  `Deactivate`. Archive ≠ Lock (archive hides; lock makes
  read-only) — the distinction is technically meaningful but the
  UI doesn't make it obvious.
- `Marks` vs `Grades` — both appear in user copy.
- `Session` vs `Academic year` vs `Year` — inconsistent.

**Severity**: MEDIUM. Confuses new operators; week-2 admins
internalize it.

**Pre-launch mitigation**:
- Add a one-page glossary to the pilot-school welcome packet:
  - **Archive** = soft-delete; restorable.
  - **Lock** = read-only; unlock to edit.
  - **Marks** = the numbers entered per subject.
  - **Grades** = the letter result (A+, B, NG).
  - **Session** = academic year.

**Post-launch fix** (P2 — combine with a copy-audit phase):
- Walk every user-visible string against the glossary.
- Standardize.

## R4 — Mobile/tablet shows desktop tables (MEDIUM)

**Scenario**: A teacher takes attendance on an iPad. The page
renders the desktop table inside an `overflow-x-auto` wrapper. The
teacher pinch-zooms repeatedly to mark each cell.

**Why**: `MobileAttendanceList` component exists but isn't
auto-mounted on tablet breakpoints. Same applies to student tables
and fees history tables.

**Severity**: MEDIUM. Teachers will use iPads. Friction adds up
across daily marking.

**Pre-launch mitigation**:
- Document: "for best mobile experience, rotate iPad to landscape
  or use a laptop."

**Post-launch fix** (P1 launch-week):
- Add responsive `md:` breakpoint:
  - `< md` → MobileAttendanceList
  - `≥ md` → desktop grid
- Apply same to students + fees tables.

## R5 — Session-lock with no typed-confirm + no impact summary (MEDIUM)

**Scenario**: An admin locks the active session ("freeze the year")
without realizing it blocks every marks / attendance / exam write
for the entire school for the rest of the year.

**Why**: The session-lock toggle has a simple destructive-button
modal. No "this will block 12 active exams + 1,200 students from
attendance edits" summary.

**Severity**: MEDIUM. Reversible (unlock works), but causes a "why
is everything failing today?" support ticket within minutes.

**Pre-launch mitigation**:
- Train: "only lock the session at year-end, after promotion."

**Post-launch fix** (P2):
- Pre-fetch the count of affected entities and show it in the
  confirm dialog: "Locking will block marks edits on 12 exams and
  attendance on 1,200 students until you unlock. Type LOCK to
  confirm."

## R6 — Single-mark correction is slow (LOW-MEDIUM)

**Scenario**: A teacher mistypes one mark in a 60-student grid. To
correct it, they need to:
1. Navigate back to /exams/marks
2. Reselect the (exam, class, subject)
3. Wait for the grid to load
4. Edit the one cell
5. Save the entire grid

5 steps for one cell. Alternatively, fall back to /exams/individual
(per-student form) — also slow.

**Why**: No inline single-cell edit affordance.

**Severity**: LOW-MEDIUM. Annoying, not blocking. Teachers will
internalize the workflow.

**Pre-launch mitigation**:
- Train: "for one correction, use /exams/individual + the student
  picker; the form pre-fills with existing marks."

**Post-launch fix** (P2):
- Add right-click → Edit / Save inline on a single cell of the
  marks grid (only when the exam is unlocked).

## R7 — Onboarding wizard skips "enroll first student" (LOW)

**Scenario**: A new admin completes the wizard
(school profile → classes → staff → fees) and lands on /dashboard
expecting to be done — only to realize there are no students yet,
so attendance / marks / fees are all unusable.

**Why**: The onboarding wizard at `/onboarding` doesn't include an
"enroll first student" step.

**Severity**: LOW. The empty state on `/students` is informative
and offers a CTA — but the wizard could nudge here.

**Pre-launch mitigation**:
- Pilot-school welcome packet documents the post-wizard step:
  "after finishing setup, click Students → Add Student."

**Post-launch fix** (P3):
- Add a 5th step to the wizard.

## R8 — Attendance page lacks "last marked by" stamp (LOW)

**Scenario**: Two teachers can mark attendance for the same class
on the same day (the upsert is idempotent on the latest state).
Without an inline "last marked by X at Y" stamp, the second
teacher doesn't know they overwrote the first's entries.

**Why**: `AuditStamp` primitive exists but isn't surfaced on the
attendance page. Audit feed has the data; operator has to dig.

**Severity**: LOW. Bulk-overwrite audit emits via
`ATTENDANCE_BULK_OVERWRITE`, so it's recoverable in the feed. But
operationally, surface in-place is much friendlier.

**Pre-launch mitigation**:
- Train: "if attendance looks wrong, check `/audit/recent` for
  ATTENDANCE_BULK_OVERWRITE entries."

**Post-launch fix** (P1):
- Drop `AuditStamp` above the attendance grid showing the
  most-recent edit's actor + time. Reads from the existing audit
  feed.

## R9 — Fee history doesn't surface REFUNDED state clearly (MEDIUM)

**Scenario**: A parent asks "did my fee actually get refunded?"
The cashier opens the student's fees history; refunded rows are
rendered with `.opacity-60` but no explicit "REFUNDED" status
column. Cashier squints.

**Why**: Fee history table uses opacity dimming but no status chip.

**Severity**: MEDIUM. Parent-facing trust signal that the cashier
relays.

**Pre-launch mitigation**:
- Train: "click into each payment row to see its status."

**Post-launch fix** (P1):
- Add a `Status` column with ACTIVE / REFUNDED / VOID chips. The
  data is already on `Payment.status` — pure rendering change.

## R10 — Empty dashboard on first login (LOW)

**Scenario**: New admin lands on /dashboard after onboarding. All
KPI tiles show zeros (no students, no payments). Looks broken.

**Why**: Dashboard renders the live data with no special
"first-time" copy.

**Severity**: LOW. Operator quickly clicks Students → realizes it's
just empty.

**Pre-launch mitigation**:
- Welcome packet says "expect zero numbers until you enrol students."

**Post-launch fix** (P3):
- Replace the dashboard with a "Getting started" panel until the
  school has ≥ 1 student, then flip to the live KPIs.

## Operational support runbook for pilot

When the pilot school's admin reports an issue, work through this
list before paging engineering:

1. **"My change disappeared"** → likely R1 (cross-tab edit).
   Confirm by checking `/audit/recent` for two `STUDENT_UPDATED`
   rows close together by different actors. Apologize; ask the
   user to refresh before editing.
2. **"I can't take attendance"** → check if the session is locked
   (R5). Check `/settings/sessions`. If locked, unlock; otherwise
   check if the student's class is archived.
3. **"Wrong amount refunded"** → check `/audit/recent` for the
   `PAYMENT_REFUNDED` entry. Backend audit row carries actor +
   amount + reason. R2 + R9.
4. **"Why is dashboard slow?"** → open `/platform/operations`,
   check request panel. See `PERFORMANCE_RECON_REPORT.md` §13.
5. **"What does archive mean?"** → R3. Glossary in welcome packet.
6. **"My iPad doesn't show the grid right"** → R4. Suggest
   landscape or laptop.

## Risk burn-down plan

| Risk | Pre-launch action | Launch-week action | Post-launch action |
| --- | --- | --- | --- |
| R1 | Training note | — | P1 fix (ETag) |
| R2 | Training note | P1 fix (typed-confirm) | — |
| R3 | Glossary | — | P2 copy audit |
| R4 | Training note | P1 fix (responsive breakpoint) | — |
| R5 | Training note | — | P2 impact-summary dialog |
| R6 | Training note | — | P2 inline edit |
| R7 | Welcome packet | — | P3 wizard step |
| R8 | Training note | P1 audit stamp | — |
| R9 | Training note | P1 status column | — |
| R10 | Welcome packet | — | P3 getting-started panel |

**Launch-week P1 fixes** (4 items): R2, R4, R8, R9. Each is a
small, well-bounded change.

**P2 next phase** (3 items): R3, R5, R6.

**P3 backlog** (2 items): R7, R10.
