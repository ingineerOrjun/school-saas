import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

// Mock the api module BEFORE importing anything that uses it. Same
// pattern as the other lib tests; the ApiError shape is a minimal
// recreation because the real one lives behind a side-effecty
// module (toast / localStorage).
jest.mock("../api", () => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly body?: unknown,
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
import { qk } from "../query-keys";
import {
  useUpsertContinuousRecord,
  type ContinuousRecordDto,
  type UpsertRatingInput,
} from "../continuous-records";

const mockedApi = api as jest.MockedFunction<typeof api>;

// We need access to the SAME QueryClient instance the hook uses so
// our tests can read what setQueryData wrote. `createWrapper` in
// test-utils builds a fresh client per test internally — we replicate
// that pattern but expose the client so we can assert on its cache.
function wrapperWithClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

const SAVED_RECORD: ContinuousRecordDto = {
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
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

const SAMPLE_INPUT: UpsertRatingInput = {
  studentId: "student-1",
  outcomeId: "outcome-1",
  sessionId: "session-1",
  phase: "REGULAR",
  rating: 3,
  subjectCode: "ENGLISH",
};

// ============================================================================
// useUpsertContinuousRecord — mutation regression tests (Session 6b).
//
// Covers the four contracts the spec calls out:
//   1. Success: cache is updated via setQueryData (no invalidation,
//      no extra fetch).
//   2. Error: no cache update, error propagates to onError.
//   3. No retry on 4xx — mutationFn called exactly once.
//   4. Cache key correctness — the canonical key from
//      qk.continuousRecordsForStudent is used (not a hand-rolled key
//      that would silently miss the consumer's cache slot).
// ============================================================================

describe("useUpsertContinuousRecord", () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it("on success: updates the per-student cache via setQueryData", async () => {
    mockedApi.mockResolvedValueOnce(SAVED_RECORD);
    const { client, Wrapper } = wrapperWithClient();

    const { result } = renderHook(() => useUpsertContinuousRecord(), {
      wrapper: Wrapper,
    });

    result.current.mutate(SAMPLE_INPUT);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Cache slot the consumer (rating screen) reads from.
    const key = qk.continuousRecordsForStudent(
      "student-1",
      "session-1",
      "ENGLISH",
    );
    const cached = client.getQueryData<ContinuousRecordDto[]>(key);
    expect(cached).toEqual([SAVED_RECORD]);
  });

  it("on success: replaces an existing record with same (outcomeId, phase) — idempotent re-rate", async () => {
    // Pre-seed the cache with a previous rating; the upsert should
    // REPLACE that entry, not append a duplicate.
    const { client, Wrapper } = wrapperWithClient();
    const key = qk.continuousRecordsForStudent(
      "student-1",
      "session-1",
      "ENGLISH",
    );
    const previous: ContinuousRecordDto = { ...SAVED_RECORD, rating: 2 };
    client.setQueryData(key, [previous]);

    mockedApi.mockResolvedValueOnce(SAVED_RECORD); // rating: 3

    const { result } = renderHook(() => useUpsertContinuousRecord(), {
      wrapper: Wrapper,
    });
    result.current.mutate(SAMPLE_INPUT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const after = client.getQueryData<ContinuousRecordDto[]>(key);
    expect(after).toHaveLength(1);
    expect(after?.[0]).toEqual(SAVED_RECORD);
  });

  it("on success: appends when no record for the same (outcomeId, phase) exists yet", async () => {
    const { client, Wrapper } = wrapperWithClient();
    const key = qk.continuousRecordsForStudent(
      "student-1",
      "session-1",
      "ENGLISH",
    );
    // Pre-seed an UNRELATED outcome — should be preserved.
    const otherOutcome: ContinuousRecordDto = {
      ...SAVED_RECORD,
      id: "rec-other",
      outcomeId: "outcome-OTHER",
    };
    client.setQueryData(key, [otherOutcome]);

    mockedApi.mockResolvedValueOnce(SAVED_RECORD);
    const { result } = renderHook(() => useUpsertContinuousRecord(), {
      wrapper: Wrapper,
    });
    result.current.mutate(SAMPLE_INPUT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const after = client.getQueryData<ContinuousRecordDto[]>(key);
    expect(after).toHaveLength(2);
    expect(after).toEqual(expect.arrayContaining([otherOutcome, SAVED_RECORD]));
  });

  it("on error: no cache update, error propagates", async () => {
    const { ApiError } = jest.requireMock("../api") as {
      ApiError: new (s: number, m: string) => Error;
    };
    // 422 — backend's AFTER_SUPPORT precondition rejection.
    mockedApi.mockRejectedValueOnce(
      new ApiError(
        422,
        "After-support assessment requires a regular assessment with rating 1 or 2 first.",
      ),
    );
    const { client, Wrapper } = wrapperWithClient();

    const { result } = renderHook(() => useUpsertContinuousRecord(), {
      wrapper: Wrapper,
    });
    result.current.mutate({ ...SAMPLE_INPUT, phase: "AFTER_SUPPORT" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Error is the ApiError, message preserved for the caller's toast.
    expect((result.current.error as Error).message).toMatch(
      /After-support assessment requires/i,
    );

    // Cache was NOT touched.
    const key = qk.continuousRecordsForStudent(
      "student-1",
      "session-1",
      "ENGLISH",
    );
    expect(client.getQueryData(key)).toBeUndefined();
  });

  it("does NOT retry on 4xx — mutationFn called exactly once", async () => {
    const { ApiError } = jest.requireMock("../api") as {
      ApiError: new (s: number, m: string) => Error;
    };
    mockedApi.mockRejectedValueOnce(new ApiError(403, "scope rejected"));

    const { Wrapper } = wrapperWithClient();
    const { result } = renderHook(() => useUpsertContinuousRecord(), {
      wrapper: Wrapper,
    });
    result.current.mutate(SAMPLE_INPUT);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedApi).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 5xx either — single attempt regardless of failure class", async () => {
    const { ApiError } = jest.requireMock("../api") as {
      ApiError: new (s: number, m: string) => Error;
    };
    mockedApi.mockRejectedValueOnce(new ApiError(500, "boom"));

    const { Wrapper } = wrapperWithClient();
    const { result } = renderHook(() => useUpsertContinuousRecord(), {
      wrapper: Wrapper,
    });
    result.current.mutate(SAMPLE_INPUT);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedApi).toHaveBeenCalledTimes(1);
  });

  it("subjectCode is NOT sent to the server (it's cache-key metadata only)", async () => {
    mockedApi.mockResolvedValueOnce(SAVED_RECORD);
    const { Wrapper } = wrapperWithClient();
    const { result } = renderHook(() => useUpsertContinuousRecord(), {
      wrapper: Wrapper,
    });
    result.current.mutate(SAMPLE_INPUT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The api call's body should NOT contain subjectCode — the
    // backend derives subject from the outcome, and the field is
    // here only to discriminate cache slots on the frontend.
    expect(mockedApi).toHaveBeenCalledTimes(1);
    const [, init] = mockedApi.mock.calls[0];
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.subjectCode).toBeUndefined();
    expect(body.studentId).toBe("student-1");
    expect(body.outcomeId).toBe("outcome-1");
    expect(body.sessionId).toBe("session-1");
    expect(body.phase).toBe("REGULAR");
    expect(body.rating).toBe(3);
  });

  it("uses the canonical query-keys.ts factory for the cache slot", async () => {
    // Regression guard against a future refactor inlining the key
    // shape. If qk.continuousRecordsForStudent changes structure,
    // the consumer hook and the mutation hook must update together.
    mockedApi.mockResolvedValueOnce(SAVED_RECORD);
    const { client, Wrapper } = wrapperWithClient();

    const { result } = renderHook(() => useUpsertContinuousRecord(), {
      wrapper: Wrapper,
    });
    result.current.mutate(SAMPLE_INPUT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Independently call the factory and confirm the cache slot at
    // that key matches what setQueryData wrote.
    const canonical = qk.continuousRecordsForStudent(
      "student-1",
      "session-1",
      "ENGLISH",
    );
    expect(client.getQueryData(canonical)).toEqual([SAVED_RECORD]);

    // The narrower (no subjectCode) variant should NOT be populated —
    // otherwise a consumer that called the read hook without
    // subjectCode would silently miss the write.
    const narrower = qk.continuousRecordsForStudent("student-1", "session-1");
    expect(client.getQueryData(narrower)).toBeUndefined();
  });
});
