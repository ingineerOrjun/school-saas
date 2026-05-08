-- ============================================================================
-- Add `absent` flag to results — drives the bulk marks-entry grid's
-- per-row "Absent" checkbox.
--
-- Semantics (enforced by ResultService.gridSave):
--   • absent = false → row is a normal mark (theoryMarks + practicalMarks)
--   • absent = true  → student did not appear; theoryMarks/practicalMarks
--                      are forced to 0 server-side, and the letter grade
--                      is forced to NG regardless of any other input.
--
-- DEFAULT false so every existing row remains valid and represents
-- "marks were entered" rather than "absent".
-- ============================================================================

ALTER TABLE "results"
  ADD COLUMN "absent" BOOLEAN NOT NULL DEFAULT false;
