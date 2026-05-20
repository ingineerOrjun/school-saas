import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { StudentRatingRow } from "../_components/StudentRatingRow";
import { EMPTY_CELL, type CellState } from "../_lib/rating-cell";
import type { StudentDto } from "@/lib/students";

// ============================================================================
// StudentRatingRow tests (Deviation 001 rewrite).
//
// Layout shift since the previous version:
//   • Two button groups per row — REGULAR + AFTER_SUPPORT inline,
//     not a single column + amber-dot modal.
//   • Row accent: 3px colored left border + tinted background + a
//     lucide icon at the right of the first line. All three driven
//     by `getEffectiveRating(cell)`.
//
// Callback shape change:
//   • `onRate(phase, value)` (was `onRate(value)`)
//   • `onRetry(phase)` (was `onRetry()`)
//   • The old `onAfterSupportClick` prop is gone (no modal).
//
// Preserved bug-fix invariants:
//   • `loadingRating: true` disables BOTH groups' buttons (was: only
//     the single REGULAR group).
//   • Clicking a disabled button does NOT fire onRate.
// ============================================================================

function makeStudent(overrides: Partial<StudentDto> = {}): StudentDto {
  return {
    id: "s-1",
    firstName: "Aakash",
    lastName: "Shrestha",
    symbolNumber: "1",
    schoolId: "school-1",
    userId: null,
    gender: "MALE",
    dateOfBirth: "2014-01-01",
    parentName: "Parent",
    contactNumber: "9800000000",
    address: null,
    admissionDate: null,
    classId: "c-1",
    class: null,
    sectionId: null,
    section: null,
    archivedAt: null,
    archivedById: null,
    archiveReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderInList(node: React.ReactElement) {
  return render(<ul>{node}</ul>);
}

const NOOP_RATE = () => {};
const NOOP_RETRY = () => {};

function cellWith(overrides: Partial<CellState>): CellState {
  return { ...EMPTY_CELL, ...overrides };
}

// ============================================================================
// Loading state — invariant carried from earlier sessions
// ============================================================================
describe("StudentRatingRow — loadingRating disables BOTH phase groups", () => {
  it("disables all 8 rating buttons (4 REGULAR + 4 AFTER_SUPPORT) when loadingRating is true", () => {
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={EMPTY_CELL}
        loadingRating={true}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );
    for (const v of [1, 2, 3, 4]) {
      expect(
        screen.getByRole("button", { name: `Rate REGULAR ${v}` }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: `Rate AFTER_SUPPORT ${v}` }),
      ).toBeDisabled();
    }
  });

  it("does NOT call onRate when a disabled button is clicked", () => {
    const onRate = jest.fn();
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={EMPTY_CELL}
        loadingRating={true}
        onRate={onRate}
        onRetry={NOOP_RETRY}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rate REGULAR 3" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Rate AFTER_SUPPORT 3" }),
    );
    expect(onRate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Two-column layout (Deviation 001) — labels + group testids
// ============================================================================
describe("StudentRatingRow — two-column layout", () => {
  it("renders both REGULAR and AFTER_SUPPORT button groups with labels", () => {
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={EMPTY_CELL}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );
    // Both groups present
    expect(screen.getByTestId("phase-group-REGULAR")).toBeInTheDocument();
    expect(
      screen.getByTestId("phase-group-AFTER_SUPPORT"),
    ).toBeInTheDocument();
    // Visible labels
    expect(screen.getByText("Regular")).toBeInTheDocument();
    expect(screen.getByText("After support")).toBeInTheDocument();
  });

  it("clicking a REGULAR button calls onRate('REGULAR', value)", () => {
    const onRate = jest.fn();
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={EMPTY_CELL}
        loadingRating={false}
        onRate={onRate}
        onRetry={NOOP_RETRY}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rate REGULAR 3" }));
    expect(onRate).toHaveBeenCalledWith("REGULAR", 3);
  });

  it("clicking an AFTER_SUPPORT button calls onRate('AFTER_SUPPORT', value)", () => {
    const onRate = jest.fn();
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={EMPTY_CELL}
        loadingRating={false}
        onRate={onRate}
        onRetry={NOOP_RETRY}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rate AFTER_SUPPORT 2" }),
    );
    expect(onRate).toHaveBeenCalledWith("AFTER_SUPPORT", 2);
  });
});

// ============================================================================
// AFTER_SUPPORT ghosted rendering — the Deviation 001 visual signal
// ============================================================================
describe("StudentRatingRow — AFTER_SUPPORT ghosted display", () => {
  it("renders the AFTER_SUPPORT button matching REGULAR as ghosted when afterSupport is null", () => {
    // Teacher set REGULAR=3, hasn't touched AFTER_SUPPORT yet.
    // The "3" button under AFTER_SUPPORT should render with the
    // ghost aria-label so a screen-reader user understands it's a
    // default, not a confirmed selection. Visual ghosting (dashed
    // border, opacity) is enforced via the className contains
    // assertion below.
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={cellWith({ regular: 3, afterSupport: null })}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );

    // The ghosted button carries the "default — tap to confirm or
    // change" aria-label. The non-ghosted "Rate AFTER_SUPPORT 3"
    // label does NOT exist for this button — it's been replaced.
    const ghosted = screen.getByRole("button", {
      name: "After-support default 3 — tap to confirm or change",
    });
    expect(ghosted).toBeInTheDocument();
    // aria-pressed is false because the value isn't actually
    // confirmed yet — it's just a default.
    expect(ghosted).toHaveAttribute("aria-pressed", "false");
    // Dashed border class is the visual ghosting signal.
    expect(ghosted.className).toMatch(/border-dashed/);
  });

  it("renders the AFTER_SUPPORT button as fully filled (aria-pressed=true) when explicitly set", () => {
    // Teacher tapped AFTER_SUPPORT=4 — it should look identical to
    // a confirmed REGULAR button: aria-pressed=true, no dashed
    // border, normal "Rate AFTER_SUPPORT 4" label.
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={cellWith({ regular: 2, afterSupport: 4 })}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );
    const confirmed = screen.getByRole("button", {
      name: "Rate AFTER_SUPPORT 4",
    });
    expect(confirmed).toHaveAttribute("aria-pressed", "true");
    expect(confirmed.className).not.toMatch(/border-dashed/);
  });

  it("renders no ghosted button when REGULAR is also unrated", () => {
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={EMPTY_CELL}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );
    // No "default" aria-label anywhere.
    expect(
      screen.queryByRole("button", {
        name: /After-support default \d+ — tap to confirm or change/,
      }),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// Row color + icon — driven by getEffectiveRating
// ============================================================================
describe("StudentRatingRow — row accent (color + icon)", () => {
  const CASES = [
    {
      label: "rating 1",
      cell: cellWith({ regular: 1 }),
      effectiveLabel: "Needs significant support",
      bgClass: "bg-red-50",
      borderClass: "border-red-500",
    },
    {
      label: "rating 2",
      cell: cellWith({ regular: 2 }),
      effectiveLabel: "Needs follow-up",
      bgClass: "bg-yellow-50",
      borderClass: "border-yellow-500",
    },
    {
      label: "rating 3",
      cell: cellWith({ regular: 3 }),
      effectiveLabel: "Achieved",
      bgClass: "bg-blue-50",
      borderClass: "border-blue-500",
    },
    {
      label: "rating 4",
      cell: cellWith({ regular: 4 }),
      effectiveLabel: "Exceeded expectations",
      bgClass: "bg-green-50",
      borderClass: "border-green-500",
    },
  ];

  for (const c of CASES) {
    it(`renders the correct accent + aria-label for ${c.label}`, () => {
      renderInList(
        <StudentRatingRow
          student={makeStudent()}
          displayName="Aakash"
          cell={c.cell}
          loadingRating={false}
          onRate={NOOP_RATE}
          onRetry={NOOP_RETRY}
        />,
      );
      const row = screen.getByTestId("student-row");
      expect(row.className).toMatch(new RegExp(c.bgClass));
      expect(row.className).toMatch(new RegExp(c.borderClass));
      // Screen-reader text is the canonical accessibility signal.
      expect(screen.getByText(c.effectiveLabel)).toBeInTheDocument();
    });
  }

  it("renders no accent and the 'Not yet rated' SR label when neither phase is rated", () => {
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={EMPTY_CELL}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );
    const row = screen.getByTestId("student-row");
    // Transparent border preserves layout alignment without showing
    // a colored accent.
    expect(row.className).toMatch(/border-transparent/);
    expect(screen.getByText("Not yet rated")).toBeInTheDocument();
    // The icon slot is reserved (preserved layout width) but empty.
    expect(screen.getByTestId("row-icon-placeholder")).toBeInTheDocument();
  });

  it("uses afterSupport for row accent when explicitly set (overrides regular)", () => {
    // The point of getEffectiveRating: REGULAR=2 + AFTER_SUPPORT=4
    // renders a GREEN row, not yellow. Final report calculations
    // use the same precedence; the row color matches the report.
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={cellWith({ regular: 2, afterSupport: 4 })}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );
    const row = screen.getByTestId("student-row");
    expect(row.className).toMatch(/bg-green-50/);
    expect(screen.getByText("Exceeded expectations")).toBeInTheDocument();
  });
});

// ============================================================================
// Per-group sync indicators
// ============================================================================
describe("StudentRatingRow — per-group sync icons", () => {
  it("renders the REGULAR pending clock when regularSyncStatus is 'pending'", () => {
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={cellWith({ regular: 3, regularSyncStatus: "pending" })}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );
    expect(screen.getByTestId("sync-pending-REGULAR")).toBeInTheDocument();
    expect(
      screen.queryByTestId("sync-pending-AFTER_SUPPORT"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("sync-failed-REGULAR"),
    ).not.toBeInTheDocument();
  });

  it("renders the AFTER_SUPPORT failed icon and calls onRetry('AFTER_SUPPORT') on click", () => {
    const onRetry = jest.fn();
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={cellWith({
          regular: 3,
          regularSyncStatus: "synced",
          afterSupport: 2,
          afterSupportSyncStatus: "failed",
        })}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.queryByTestId("sync-failed-REGULAR"),
    ).not.toBeInTheDocument();
    const failedBtn = screen.getByTestId("sync-failed-AFTER_SUPPORT");
    expect(failedBtn).toHaveAttribute(
      "aria-label",
      "Retry saving AFTER_SUPPORT rating",
    );
    fireEvent.click(failedBtn);
    expect(onRetry).toHaveBeenCalledWith("AFTER_SUPPORT");
  });

  it("renders no icons at all when both groups are synced (WhatsApp absence-is-success)", () => {
    renderInList(
      <StudentRatingRow
        student={makeStudent()}
        displayName="Aakash"
        cell={cellWith({
          regular: 3,
          afterSupport: 4,
          regularSyncStatus: "synced",
          afterSupportSyncStatus: "synced",
        })}
        loadingRating={false}
        onRate={NOOP_RATE}
        onRetry={NOOP_RETRY}
      />,
    );
    expect(
      screen.queryByTestId("sync-pending-REGULAR"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("sync-pending-AFTER_SUPPORT"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("sync-failed-REGULAR"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("sync-failed-AFTER_SUPPORT"),
    ).not.toBeInTheDocument();
  });
});
