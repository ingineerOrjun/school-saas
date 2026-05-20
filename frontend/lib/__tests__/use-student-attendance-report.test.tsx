import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

// ============================================================================
// useStudentAttendanceReport — date-normalization regression.
//
// The backend's `/attendance/report` DTO has a strict
//   @Matches(/^\d{4}-\d{2}-\d{2}$/)
// validator on `fromDate` / `toDate`. The AcademicSession DTO's
// startDate/endDate fields arrive over the wire as full ISO timestamps
// ("2026-04-01T00:00:00.000Z"), so a naive forward of those values
// produced a 400. The hook's internal `toYMD()` helper slices ISO
// timestamps down to YYYY-MM-DD before sending.
//
// These tests pin that contract — the hook must hit `api()` with a
// YYYY-MM-DD-shaped URL regardless of whether the caller passed an
// already-trimmed date or a full ISO timestamp.
// ============================================================================

jest.mock("../api", () => {
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

// useAuthReady normally subscribes to the auth store; stub it so the
// `enabled` gate inside the hook passes deterministically.
jest.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ authReady: true, isAuthenticated: true }),
}));

import { api } from "../api";
import { useStudentAttendanceReport } from "../attendance";

const mockedApi = api as jest.MockedFunction<typeof api>;

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useStudentAttendanceReport — date normalization", () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedApi.mockResolvedValue({
      scope: "student",
      fromDate: "2026-04-01",
      toDate: "2027-03-31",
      totalDays: 0,
      presentDays: 0,
      absentDays: 0,
      percentage: null,
      student: {
        id: "student-1",
        firstName: "Aakash",
        lastName: "Shrestha",
        symbolNumber: "12",
        section: null,
      },
    });
  });

  it("trims ISO timestamps to YYYY-MM-DD before issuing the request", async () => {
    const { result } = renderHook(
      () =>
        useStudentAttendanceReport("student-1", {
          // Exactly what AcademicSessionDto.startDate looks like over
          // the wire — ISO timestamp despite the field "being" a
          // Postgres DATE.
          fromDate: "2026-04-01T00:00:00.000Z",
          toDate: "2027-03-31T00:00:00.000Z",
          sessionId: "session-1",
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi).toHaveBeenCalledTimes(1);
    const url = mockedApi.mock.calls[0][0] as string;
    // The on-the-wire URL carries the sliced 10-char dates ONLY —
    // no "T00:00:00.000Z" residue. The DTO's strict regex rejects
    // anything wider.
    expect(url).toContain("fromDate=2026-04-01");
    expect(url).toContain("toDate=2027-03-31");
    expect(url).not.toMatch(/fromDate=\d{4}-\d{2}-\d{2}T/);
    expect(url).not.toMatch(/toDate=\d{4}-\d{2}-\d{2}T/);
  });

  it("passes through already-shaped YYYY-MM-DD inputs unchanged", async () => {
    const { result } = renderHook(
      () =>
        useStudentAttendanceReport("student-1", {
          fromDate: "2026-04-01",
          toDate: "2027-03-31",
          sessionId: "session-1",
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = mockedApi.mock.calls[0][0] as string;
    expect(url).toContain("fromDate=2026-04-01");
    expect(url).toContain("toDate=2027-03-31");
  });

  it("includes studentId in the query string but NOT sessionId", async () => {
    // The backend's global ValidationPipe has forbidNonWhitelisted on,
    // and the ReportQueryDto doesn't declare sessionId — sending it
    // would trip "property sessionId should not exist". The hook
    // keeps sessionId as a cache-key discriminator only.
    const { result } = renderHook(
      () =>
        useStudentAttendanceReport("student-1", {
          fromDate: "2026-04-01T00:00:00.000Z",
          toDate: "2027-03-31T00:00:00.000Z",
          sessionId: "session-1",
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = mockedApi.mock.calls[0][0] as string;
    expect(url).toContain("studentId=student-1");
    expect(url).not.toContain("sessionId=");
  });

  it("different sessionIds produce different cache slots even though the URL is the same", async () => {
    // Same student + dates, two different sessionIds → two cache
    // slots → two fetches. Pin the discriminator behavior so a
    // future "drop sessionId from the cache key" refactor surfaces
    // here as a cache-collision test failure.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const sharedWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result: r1 } = renderHook(
      () =>
        useStudentAttendanceReport("student-1", {
          fromDate: "2026-04-01",
          toDate: "2027-03-31",
          sessionId: "session-A",
        }),
      { wrapper: sharedWrapper },
    );
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));

    const { result: r2 } = renderHook(
      () =>
        useStudentAttendanceReport("student-1", {
          fromDate: "2026-04-01",
          toDate: "2027-03-31",
          sessionId: "session-B",
        }),
      { wrapper: sharedWrapper },
    );
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));

    // Two cache slots → two fetches. (If sessionId were dropped from
    // the cache key, the second hook would hit the first's cached
    // result and api() would be called only once.)
    expect(mockedApi).toHaveBeenCalledTimes(2);

    // Sanity: neither URL leaked sessionId — the discriminator lives
    // in the cache key, not on the wire.
    for (const call of mockedApi.mock.calls) {
      expect(call[0] as string).not.toContain("sessionId=");
    }
  });

  it("does not fire while `studentId` is undefined", () => {
    renderHook(
      () =>
        useStudentAttendanceReport(undefined, {
          fromDate: "2026-04-01",
          toDate: "2027-03-31",
        }),
      { wrapper },
    );
    // useQuery starts in `enabled: false` → no api call.
    expect(mockedApi).not.toHaveBeenCalled();
  });
});
