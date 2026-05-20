import * as React from "react";
import { render, screen } from "@testing-library/react";

// ============================================================================
// /students/[id] — student detail page tests (Session 6c-detail).
//
// Strategy: mock the page's hooks at the @/lib/* boundary so we control
// each section's data independently. The page composes 6+ hooks; testing
// it via real api() mocking would require coordinating 6+ request URLs.
// Hook-level mocking lets each test focus on a single behavioral
// invariant (identity renders, 404 fallback, CDC placeholder, section
// error isolation) without the noise.
//
// ApiError is re-declared as a plain class because the real `@/lib/api`
// has side effects (localStorage, toast) we don't need here.
// ============================================================================

jest.mock("@/lib/api", () => {
  // Inlined inside the factory because Jest hoists jest.mock() to the
  // top of the file, ahead of any module-scope class declarations.
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    api: jest.fn(),
    isNetworkError: () => false,
    ApiError,
  };
});

// Pull the mocked ApiError out so the tests below can construct
// instances against the same constructor `instanceof` checks in the
// page will compare against.
const { ApiError: MockApiError } = jest.requireMock("@/lib/api") as {
  ApiError: new (status: number, message: string) => Error & { status: number };
};

// Mock next/navigation: useParams returns a fixed id; useRouter is a stub.
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "student-1" }),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

// Mock sonner so toasts don't try to mount a real toaster.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

// Stable mock implementations per test. Tests reach into these to
// override the return shapes; afterEach resets to defaults.
const studentHook = jest.fn();
const attendanceHook = jest.fn();
const feesHook = jest.fn();
const examsHook = jest.fn();
const examResultsHook = jest.fn();
const outcomesHook = jest.fn();
const recordsHook = jest.fn();
const academicSessionHook = jest.fn();

jest.mock("@/lib/students", () => {
  const actual = jest.requireActual("@/lib/students");
  return {
    ...actual,
    useStudent: (...args: unknown[]) => studentHook(...args),
  };
});
jest.mock("@/lib/attendance", () => ({
  ...jest.requireActual("@/lib/attendance"),
  useStudentAttendanceReport: (...args: unknown[]) => attendanceHook(...args),
}));
jest.mock("@/lib/fees", () => ({
  ...jest.requireActual("@/lib/fees"),
  useStudentFees: (...args: unknown[]) => feesHook(...args),
}));
jest.mock("@/lib/exams", () => ({
  ...jest.requireActual("@/lib/exams"),
  useExams: (...args: unknown[]) => examsHook(...args),
  useStudentExamResults: (...args: unknown[]) => examResultsHook(...args),
}));
jest.mock("@/lib/learning-outcomes", () => ({
  ...jest.requireActual("@/lib/learning-outcomes"),
  useLearningOutcomesByClassAndSubject: (...args: unknown[]) =>
    outcomesHook(...args),
}));
jest.mock("@/lib/continuous-records", () => ({
  ...jest.requireActual("@/lib/continuous-records"),
  useContinuousRecordsForStudent: (...args: unknown[]) => recordsHook(...args),
}));
jest.mock(
  "@/components/academic-session/AcademicSessionProvider",
  () => ({
    useAcademicSession: () => academicSessionHook(),
  }),
);

// `<DualDate>` depends on CalendarProvider, which we don't mount in
// tests. Stub it to render the ISO date as plain text — that's all
// the assertions need from it, and it side-steps the calendar
// context dependency.
jest.mock("@/components/calendar/DualDate", () => ({
  DualDate: ({ date }: { date: string }) => <>{date}</>,
}));

// `getStoredUser` reads from localStorage in real life. Tests need a
// deterministic shape; default to ADMIN so the Fees section enables.
jest.mock("@/lib/auth", () => ({
  ...jest.requireActual("@/lib/auth"),
  getStoredUser: () => ({
    id: "u-admin",
    email: "admin@school.test",
    role: "ADMIN",
    schoolId: "school-a",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
}));

import StudentDetailPage from "../page";
import type { StudentDto } from "@/lib/students";

function makeStudent(overrides: Partial<StudentDto> = {}): StudentDto {
  return {
    id: "student-1",
    firstName: "Aakash",
    lastName: "Shrestha",
    symbolNumber: "12",
    schoolId: "school-a",
    userId: null,
    gender: "MALE",
    dateOfBirth: "2014-04-15",
    parentName: "Suresh Shrestha",
    contactNumber: "9800000000",
    address: "Ward 5, Kathmandu",
    admissionDate: "2025-04-01",
    classId: "class-4",
    class: {
      id: "class-4",
      name: "Class 4",
      schoolId: "school-a",
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
    },
    sectionId: null,
    section: null,
    archivedAt: null,
    archivedById: null,
    archiveReason: null,
    createdAt: "2025-04-01T00:00:00.000Z",
    updatedAt: "2025-04-01T00:00:00.000Z",
    ...overrides,
  };
}

const HAPPY_SESSION = {
  selected: {
    id: "session-1",
    name: "2026/27",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    isActive: true,
    isLocked: false,
    schoolId: "school-a",
    createdAt: "2026-04-01",
    updatedAt: "2026-04-01",
  },
};

function resetMocksToDefaults() {
  studentHook.mockReset().mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: makeStudent(),
    refetch: jest.fn(),
  });
  attendanceHook.mockReset().mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: {
      scope: "student",
      fromDate: "2026-04-01",
      toDate: "2027-03-31",
      totalDays: 100,
      presentDays: 92,
      absentDays: 8,
      percentage: 92,
      student: {
        id: "student-1",
        firstName: "Aakash",
        lastName: "Shrestha",
        symbolNumber: "12",
        section: null,
      },
    },
    refetch: jest.fn(),
  });
  feesHook.mockReset().mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: {
      studentId: "student-1",
      firstName: "Aakash",
      lastName: "Shrestha",
      assignments: [],
      payments: [],
      totalBase: 0,
      totalAssigned: 0,
      totalDiscount: 0,
      totalPaid: 0,
      totalDue: 0,
      totalCredit: 0,
    },
    refetch: jest.fn(),
  });
  examsHook.mockReset().mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: [],
    refetch: jest.fn(),
  });
  examResultsHook.mockReset().mockReturnValue({
    byExamId: new Map(),
    isLoading: false,
    isError: false,
    errorCount: 0,
  });
  outcomesHook.mockReset().mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: [],
    refetch: jest.fn(),
  });
  recordsHook.mockReset().mockReturnValue({
    isLoading: false,
    isError: false,
    error: null,
    data: [],
    refetch: jest.fn(),
  });
  academicSessionHook.mockReset().mockReturnValue(HAPPY_SESSION);
}

beforeEach(() => {
  resetMocksToDefaults();
});

// ============================================================================
// Test 1 — Identity renders when the student exists
// ============================================================================
describe("StudentDetailPage", () => {
  it("renders identity + class when the student loads successfully", () => {
    render(<StudentDetailPage />);

    // Header
    expect(
      screen.getByRole("heading", { name: "Aakash Shrestha" }),
    ).toBeInTheDocument();

    // Class badge appears in the header AND the Academic section's
    // value field — assert at least one occurrence rather than exact
    // count (the Academic section duplicates it by design).
    expect(screen.getAllByText("Class 4").length).toBeGreaterThan(0);

    // Identity card details
    expect(screen.getByText("Suresh Shrestha")).toBeInTheDocument();
    expect(screen.getByText("9800000000")).toBeInTheDocument();
    expect(screen.getByText("Ward 5, Kathmandu")).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 2 — 404 fallback when the student doesn't exist
  // ==========================================================================
  it("renders the not-found panel when the backend returns 404", () => {
    studentHook.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new MockApiError(404, "Student not found."),
      data: undefined,
      refetch: jest.fn(),
    });

    render(<StudentDetailPage />);

    expect(
      screen.getByRole("heading", { name: /student not found/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Aakash Shrestha" }),
    ).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Test 3 — CDC section shows the placeholder for unseeded subjects
  // ==========================================================================
  it("renders 'Not yet enabled for CDC evaluation' for subjects with no seeded outcomes", () => {
    // outcomesHook returns empty for every subject → all 7 subjects
    // surface the placeholder text.
    outcomesHook.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: [],
      refetch: jest.fn(),
    });

    render(<StudentDetailPage />);

    // 7 CDC subjects → 7 placeholder rows.
    const placeholders = screen.getAllByText(
      /not yet enabled for cdc evaluation/i,
    );
    expect(placeholders.length).toBe(7);
  });

  // ==========================================================================
  // Test 4 — Section error state is independent (one section failing
  // doesn't take down the others)
  // ==========================================================================
  it("renders an inline error for a failed section while sibling sections continue to render", () => {
    // Fees section explodes; identity + academic + attendance keep
    // their happy-path mocks from beforeEach.
    feesHook.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new MockApiError(500, "Database timeout"),
      data: undefined,
      refetch: jest.fn(),
    });

    render(<StudentDetailPage />);

    // The fees error surface is in the DOM.
    expect(screen.getByText(/database timeout/i)).toBeInTheDocument();

    // And the identity section still rendered the student's identity —
    // the failing fees query did NOT block the rest of the page.
    expect(
      screen.getByRole("heading", { name: "Aakash Shrestha" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Suresh Shrestha")).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 5 — Bonus: attendance numbers render with the percentage tier color
  // ==========================================================================
  it("renders the attendance summary stats from the backend payload", () => {
    render(<StudentDetailPage />);

    // From the default mock: 92 present, 8 absent, 92% — labels + values.
    expect(screen.getByText("Days present")).toBeInTheDocument();
    expect(screen.getByText("92")).toBeInTheDocument(); // present count
    expect(screen.getByText("8")).toBeInTheDocument(); // absent count
    expect(screen.getByText("92.0%")).toBeInTheDocument();
  });
});
