# Operator Trust Surfaces

_Last updated: 2026-07-21 — Phase RELIABILITY-III Part 8._
_Audience: frontend engineers + UX-pass reviewers._

This is the catalogue of operator trust surfaces in the platform —
where the UI deliberately tells the operator "who / when / locked /
archived" so they can act with confidence. Each entry references a
real file you can open.

The goal is **not** to spray badges everywhere. The goal is to
surface the state changes operators care about, on the exact pages
where they'd otherwise have to guess.

## 1. Inventory

### 1.1 Student rows (already shipped, Phase DATA LIFECYCLE)

- `frontend/components/students/StudentTable.tsx` — `ArchivedBadge`
  next to each student's name when `archivedAt` is set. Tooltip
  carries the archive reason + date.
- `frontend/app/(dashboard)/students/page.tsx` — tab strip switches
  between Active and Archived views.

### 1.2 Marksheet header (already shipped, Phase DATA INTEGRITY)

- `frontend/app/marksheet/[examId]/[studentId]/page.tsx` —
  `LockedBadge` + `AuditStamp` showing when the exam was locked +
  by whom.

### 1.3 System Health page (already shipped, Phase STABILIZATION)

- `frontend/app/(dashboard)/settings/system/page.tsx` — backup
  freshness chip (Fresh / Stale), integrity-check status chip
  (Clean / Warnings / Errors).

### 1.4 Audit feed (already shipped, Phase OPERATIONAL VISIBILITY)

- `/audit/recent` (school) and `/platform/audit` (super-admin) —
  full chronological history with actor + IP + user-agent.

### 1.5 Receipt page trust strip (NEW — Phase RELIABILITY-III)

- `frontend/app/receipts/[paymentId]/page.tsx` —
  - Green-dot **Immutable financial record** indicator above
    every receipt.
  - `AuditStamp` showing the cashier email + `recordedAt`.
  - Amber **Refund slip** pill when the receipt is itself a refund.
  - Hidden on print (the printed slip has its own "Received by"
    line).

### 1.6 Marks-entry toolbar state banner (NEW — Phase RELIABILITY-III)

- `frontend/app/(dashboard)/exams/marks/page.tsx` →
  `ExamStateBanner` —
  - Renders only when the selected exam is `locked === true` or
    `archivedAt !== null`.
  - Combines `LockedBadge` / `ArchivedBadge` / `AuditStamp` so the
    operator sees state + when it changed BEFORE typing.
  - Rose tone for archived (more severe — needs Restore before
    anything works). Amber tone for locked (Unlock is reversible).

## 2. Surfaces we intentionally did NOT add

Decisions explained — these are NOT oversights.

### 2.1 Per-row receipt list

The fees-history page (`/fees/[studentId]`) shows a list of past
receipts. We considered adding a per-row `AuditStamp` for cashier
attribution. **Decision: not added.** The list is already wide with
amount + method + status columns; an extra column would force
horizontal scroll on small displays. The receipt's own detail page
already carries the trust strip (1.5) — operators click in for
detail. The list is for overview.

### 2.2 Per-student archive detail view

We considered a dedicated `/students/[id]/archive` route showing
the archive metadata (who archived, when, reason). **Decision:
not added.** That information is already accessible via:
- The `ArchivedBadge` tooltip on the student row.
- The `/audit/recent` feed filtered to that student.

Adding a third surface would duplicate the information without
adding action.

### 2.3 Promotion history per student

We considered a per-student "promotion timeline" view. **Decision:
defer to a future analytics phase.** The `StudentAcademicRecord`
table holds the data, but the surface needs to be designed as part
of a transcript-style UX pass — not as a quick badge addition.

## 3. The primitives — single source of truth

These primitives are the ONLY badges/stamps used across the platform.
Any new trust surface MUST reuse one of these.

| Primitive | Location | Use for |
| --- | --- | --- |
| `LockedBadge` | `frontend/components/ui/LockedBadge.tsx` | Marks lock state |
| `ArchivedBadge` | `frontend/components/ui/StatusBadges.tsx` | Soft-delete state with tooltip |
| `PublishedBadge` | `frontend/components/ui/StatusBadges.tsx` | "Published / Final" state |
| `DraftBadge` | `frontend/components/ui/StatusBadges.tsx` | "Unpublished / Editable" state |
| `PendingSyncBadge` | `frontend/components/ui/StatusBadges.tsx` | Offline-queue pending count |
| `FailedSyncBadge` | `frontend/components/ui/StatusBadges.tsx` | Most-recent sync failure |
| `AuditStamp` | `frontend/components/ui/AuditStamp.tsx` | "Action by Actor · time" line |
| `CopyableId` | `frontend/components/ui/CopyableId.tsx` | UUID/receipt-number with copy button |

If your surface needs a different visual treatment than these
primitives offer, **propose extending one of them**, don't invent a
new badge.

## 4. The placement rules

Three rules govern where trust surfaces live:

### Rule 1 — Surface state BEFORE the failing action

If an operator can attempt an action that the backend will reject
(write to a locked exam, edit an archived student), surface the
state visibly BEFORE the action. The marks-entry banner is the
canonical example — operators see "this exam is locked" right next
to the input column.

### Rule 2 — One badge per row, not three

Stacking ArchivedBadge + LockedBadge + PublishedBadge on the same
row is noise. Pick the dominant state. For an archived exam that's
also locked, ArchivedBadge wins (it's the more severe state and the
remediation is different — Restore vs. Unlock).

### Rule 3 — Trust strips on detail pages, badges on list pages

A detail page (receipt, marksheet) can afford a multi-element trust
strip with stamps and reasons. A list page should use a single
badge per row to keep scanning fast. Don't violate this without a
good reason.

## 5. PR review checklist for trust surfaces

- [ ] The surface uses one of the 8 primitives in section 3.
- [ ] The badge tooltip explains what the state means in operator
      language (not technical jargon).
- [ ] The badge is hidden on print where appropriate (`no-print` class).
- [ ] On list pages, exactly one badge per row.
- [ ] State is surfaced BEFORE the failing action, not as part of
      the failure copy.
- [ ] The placement is documented in this catalogue.

If you can't tick all six boxes, defer the change to a UX-pass
phase.

## 6. Cross-reference to operator failure copy

Trust surfaces and failure copy are paired. Every state surfaced by a
badge should have a matching entry in
`OPERATOR_FAILURE_SCENARIOS.md` for the failure case:

- `LockedBadge` ↔ scenario #2 (HTTP 423 lock rejection)
- `ArchivedBadge` (student) ↔ scenario #1 (409 on edit)
- `ArchivedBadge` (exam) ↔ scenario #2 variant (409 on marks edit)
- `Refund slip` chip on receipt ↔ scenario #8 (one-refund invariant)
- Backup freshness ↔ scenario #11 (stale backup)
- Data integrity errors ↔ scenario #12 (integrity check found errors)

The pairing means: see the badge → understand the state. Click into
the action → see the matching error copy if you violate the state.
No surprises.
