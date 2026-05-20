import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "./test-utils";

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

import { api } from "../api";
import {
  useContinuousRecordsForStudent,
  useContinuousRecordsForClassStudents,
  type ContinuousRecordDto,
} from "../continuous-records";

const mockedApi = api as jest.MockedFunction<typeof api>;

const sampleRecord: ContinuousRecordDto = {
  id: "rec-1",
  schoolId: "school-1",
  studentId: "student-1",
  outcomeId: "outcome-1",
  sessionId: "session-1",
  phase: "REGULAR",
  rating: 3,
  notes: null,
  createdById: "u-1",
  updatedById: "u-1",
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
};

describe("useContinuousRecordsForStudent", () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it("returns data on success", async () => {
    mockedApi.mockResolvedValueOnce([sampleRecord]);

    const { result } = renderHook(
      () => useContinuousRecordsForStudent("student-1", "session-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([sampleRecord]);
    expect(mockedApi).toHaveBeenCalledWith(
      "/continuous-records?studentId=student-1&sessionId=session-1",
      expect.objectContaining({ redirectOn403: false }),
    );
  });

  it("propagates subjectCode into the query string when provided", async () => {
    mockedApi.mockResolvedValueOnce([sampleRecord]);

    renderHook(
      () =>
        useContinuousRecordsForStudent("student-1", "session-1", {
          subjectCode: "ENGLISH",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(mockedApi).toHaveBeenCalled());
    expect(mockedApi).toHaveBeenCalledWith(
      "/continuous-records?studentId=student-1&sessionId=session-1&subjectCode=ENGLISH",
      expect.objectContaining({ redirectOn403: false }),
    );
  });

  it("returns error on failure (no-retry-on-4xx)", async () => {
    const { ApiError } = jest.requireMock("../api") as {
      ApiError: new (s: number, m: string) => Error;
    };
    mockedApi.mockRejectedValueOnce(new ApiError(403, "feature disabled"));

    const { result } = renderHook(
      () => useContinuousRecordsForStudent("student-1", "session-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedApi).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when enabled: false", async () => {
    mockedApi.mockResolvedValue([sampleRecord]);

    renderHook(
      () =>
        useContinuousRecordsForStudent("student-1", "session-1", {
          enabled: false,
        }),
      { wrapper: createWrapper() },
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it("does NOT fire when studentId is empty (defensive)", async () => {
    mockedApi.mockResolvedValue([sampleRecord]);

    renderHook(() => useContinuousRecordsForStudent("", "session-1"), {
      wrapper: createWrapper(),
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(mockedApi).not.toHaveBeenCalled();
  });
});

describe("useContinuousRecordsForClassStudents", () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it("fans out one query per studentId and groups results by id", async () => {
    const r1 = { ...sampleRecord, id: "rec-1", studentId: "s-1" };
    const r2 = { ...sampleRecord, id: "rec-2", studentId: "s-2" };
    mockedApi.mockImplementation(async (url: string) => {
      if (url.includes("studentId=s-1")) return [r1];
      if (url.includes("studentId=s-2")) return [r2];
      throw new Error("unexpected url: " + url);
    });

    const { result } = renderHook(
      () =>
        useContinuousRecordsForClassStudents(["s-1", "s-2"], "session-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byStudentId.get("s-1")).toEqual([r1]);
    expect(result.current.byStudentId.get("s-2")).toEqual([r2]);
    expect(result.current.errorCount).toBe(0);
    expect(result.current.isError).toBe(false);
    expect(mockedApi).toHaveBeenCalledTimes(2);
  });

  it("does NOT fire when studentIds is empty", async () => {
    mockedApi.mockResolvedValue([]);

    const { result } = renderHook(
      () => useContinuousRecordsForClassStudents([], "session-1"),
      { wrapper: createWrapper() },
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(mockedApi).not.toHaveBeenCalled();
    expect(result.current.byStudentId.size).toBe(0);
  });

  it("returns a STABLE result identity across re-renders when underlying data hasn't changed (loop-fix regression)", async () => {
    // This pins the Session 6a infinite-loop fix at the hook layer.
    // Before the fix, every render of the hook rebuilt `byStudentId`
    // as a new Map and returned a new result object. Any consumer
    // listing `records.byStudentId` in a useEffect dep array would
    // see a new identity every render → effect re-fires → if it
    // called setState → infinite loop.
    //
    // Strategy: render the hook, wait for queries to settle, then
    // force a parent re-render and verify the hook returns the SAME
    // result object reference. If this test fails, the loop is back.
    mockedApi.mockImplementation(async (url: string) => {
      if (url.includes("studentId=s-1")) return [sampleRecord];
      return [];
    });

    const { result, rerender } = renderHook(
      () => useContinuousRecordsForClassStudents(["s-1"], "session-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const firstResult = result.current;
    const firstMap = result.current.byStudentId;

    // Force a re-render of the parent component WITHOUT changing
    // inputs. The hook's memoized result should be returned as the
    // same reference both times.
    rerender();
    rerender();
    rerender();

    expect(result.current).toBe(firstResult);
    expect(result.current.byStudentId).toBe(firstMap);
  });

  it("flags partial failure via errorCount but renders successes", async () => {
    const { ApiError } = jest.requireMock("../api") as {
      ApiError: new (s: number, m: string) => Error;
    };
    const r1 = { ...sampleRecord, id: "rec-1", studentId: "s-1" };
    mockedApi.mockImplementation(async (url: string) => {
      if (url.includes("studentId=s-1")) return [r1];
      if (url.includes("studentId=s-2")) {
        throw new ApiError(403, "scope-rejected");
      }
      return [];
    });

    const { result } = renderHook(
      () =>
        useContinuousRecordsForClassStudents(["s-1", "s-2"], "session-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byStudentId.get("s-1")).toEqual([r1]);
    expect(result.current.byStudentId.has("s-2")).toBe(false);
    expect(result.current.errorCount).toBe(1);
    // 1 of 2 failing is partial — `isError` only goes true on FULL
    // failure so the screen doesn't render an error state when most
    // students loaded fine.
    expect(result.current.isError).toBe(false);
  });
});
