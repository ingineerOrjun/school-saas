# Soft-delete audit — current hard-delete surfaces

**Audited during the data-integrity hardening phase (2026-05-11).**

This is a **report only**. Per Rule 7 of the data-integrity phase
spec, no `archivedAt` flags are introduced in this phase. This
document inventories every hard-delete in the backend and ranks
them by data-loss risk so future phases can prioritize a soft-delete
migration.

## Risk ranking

### 🔴 HIGH — irreversible, cascades into financial / academic history

| Surface | File:Line | Cascade scope | Notes |
|---|---|---|---|
| **Delete student** | `student.service.ts:745` | Cascades into `Result`, `Attendance`, `FeeAssignment`, `Payment`, `StudentAcademicRecord`, `StudentGuardianLink` (per schema FK `onDelete: Cascade`) | The single most dangerous delete in the codebase. A wrong-row click loses every fee, every mark, every attendance row for that student permanently. **Already protected at the UI level** by the typed-confirmation `DeleteStudentDialog` (data-integrity phase). **TODO:** introduce `Student.archivedAt` so the row stays queryable for historical reports while being hidden from active rosters. |
| **Delete exam** | `exam.service.ts:406` | Cascades into `ExamSubject`, `Result` | Loses every mark for every student in this exam. **Lower risk than student delete because it's per-cohort, not per-person** — a wrongly-deleted exam can be re-entered if the paper marksheets exist. **TODO:** soft-delete + "archived exams" tab. |
| **Delete teacher (via user)** | `teacher.service.ts:356` | Cascades into `User`, `Teacher`, `TeachingAssignment` | Detaches the teacher from every class they were assigned to. Marks/attendance/results CREATED by them stay (audit FK is `onDelete: SetNull`). **TODO:** soft-delete so the audit history retains the teacher's name. |

### 🟠 MEDIUM — irreversible but rebuilds are cheap

| Surface | File:Line | Cascade scope | Notes |
|---|---|---|---|
| **Delete class** | `class.service.ts:64` | Cascades into `Section`, students with `classId` set get `SetNull` | Service-layer guard already blocks delete when the class has students or sections. Risk is mostly contained. **TODO (low priority):** soft-delete to preserve historical class names on archived marksheets. |
| **Delete section** | `section.service.ts:70` | Students get `sectionId = null` | Similar to class delete. Low risk. |
| **Delete subject (school catalog)** | `subject/subject.service.ts:89` | Detaches `TeachingAssignment.subjectId` (`SetNull`) | Operator-driven catalog item. Low risk. |
| **Delete exam-subject** | `exams/subject.service.ts:49` | Cascades into `Result` for that subject | Loses one column of marks. **TODO:** soft-delete OR refuse delete when `Result` rows exist. |
| **Delete teaching assignment** | `teaching-assignment.service.ts:438` | No cascade — just removes the row | Frequent operation; soft-delete would clutter the table without much benefit. Probably fine as hard-delete forever. |

### 🟢 LOW — append-only or short-lived data

| Surface | File:Line | Cascade scope | Notes |
|---|---|---|---|
| **Delete academic session** | `academic-session.service.ts:253` | `Exam.sessionId`, `Attendance.sessionId`, etc. → `SetNull` | Only allowed when the session is inactive. Rarely used; old sessions stay readable via the `SetNull` cascade. Fine as hard-delete. |
| **Delete announcement** | `announcement.service.ts:64` | No cascade — single row | Operator-driven content. Hard-delete is fine. |
| **Delete guardian** | `guardian.service.ts:152` | Cascades into `StudentGuardianLink` | Reasonable: guardians are contact records, not financial. Hard-delete fine. |
| **Delete guardian link** | `guardian.service.ts:226` | Single row | Fine. |

### Notable absences (already append-only by design)

- **Payment** — has no delete endpoint. Refunds are recorded as a
  separate `Payment` row with negative amount. The "delete payment"
  surface implied by the data-integrity phase spec doesn't exist
  in the current codebase, which is the correct design.
- **Result** — there's no per-row delete endpoint. Edits go through
  `results.save` / `bulkSave` / `gridSave`, which now respect the
  exam-level lock added in this phase.
- **Attendance** — same: no per-row delete; edits flow through `mark`,
  which now emits `ATTENDANCE_BULK_OVERWRITE` audit on bulk writes.

## Recommended next-phase work (ordered by impact)

1. **`Student.archivedAt`** — single biggest data-loss surface. Replace
   `student.delete` with `update({ archivedAt: now() })`. All read
   queries get `where: { archivedAt: null }` filter; an "archived
   students" tab exposes the others. Audit emits `STUDENT_ARCHIVED`
   instead of nothing.
2. **`Exam.archivedAt`** — same treatment. Pairs naturally with the
   already-shipped `Exam.locked` (lock first → archive later).
3. **Refuse delete when dependents exist** — the cheapest safety
   net before a full soft-delete migration. For `ExamSubject` with
   `Result` rows, just throw a 409 `ConflictException` instead of
   cascading.

## TODO markers added in code

This phase did NOT add `// TODO: soft-delete` markers in the source
to avoid noise. Future phases that touch any of the highlighted
files should consult this document.
