# CDC Compliance Deviations

This document records places where Scholaris's CDC continuous evaluation
implementation deliberately deviates from the official CDC framework
(विद्यार्थी मूल्याङ्कन मार्गदर्शन २०८३) for product or UX reasons.

These are not bugs — they are explicit product decisions made with
full awareness of the compliance implications.

## Deviation 001 — AFTER_SUPPORT available for all REGULAR ratings

**Date:** 2026-05-17

**CDC framework requirement:** AFTER_SUPPORT (after-support reassessment)
is a remedial process for students who scored REGULAR ≤ 2. Students
rated 3 or 4 do not receive after-support per the framework.

**Scholaris implementation:** AFTER_SUPPORT is allowed for any REGULAR
rating value (1, 2, 3, or 4). The UI presents inline AFTER_SUPPORT
buttons on every student row. AFTER_SUPPORT defaults to a ghosted
visual display matching REGULAR's value; the database row is only
created when the teacher explicitly taps an AFTER_SUPPORT button.

**Rationale:** The original modal-per-student after-support flow was
tedious for teachers with many students. Allowing universal
AFTER_SUPPORT input with a "two-column" mental model simplifies the
workflow: every student has two ratings, with the second defaulting
to the first until a teacher overrides.

**Audit/compliance implications:**
- Students whose AFTER_SUPPORT was never explicitly recorded have NO
  ContinuousRecord row with phase=AFTER_SUPPORT in the database.
- Students whose AFTER_SUPPORT was explicitly recorded (including
  those originally rated 3 or 4) have a database row.
- A District Education Officer reviewing audit records can distinguish
  the two cases by checking for the presence/absence of the
  AFTER_SUPPORT row.
- Final report calculations use AFTER_SUPPORT if a row exists, else
  REGULAR.

**What changed in code:**
- Backend: Removed the precondition guard in
  `ContinuousRecordService.upsertSingle` that rejected AFTER_SUPPORT
  when no REGULAR ≤ 2 existed. The guard's two backend tests were
  updated to assert the new permissive behavior.
- Frontend: Replaced the amber-dot-and-modal flow with an inline
  two-column rating UI. Added row color coding and accessibility
  icons.

**Reversibility:** Restoring CDC strict compliance is a single commit.
The precondition guard returns; the frontend modal flow returns. All
existing AFTER_SUPPORT data remains valid (no schema change).
