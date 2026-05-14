import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "./test-utils";

// Mock the api module BEFORE importing anything that uses it.
// `isNetworkError` returns false in the success+ApiError-rejection paths
// the spec wants us to exercise. `ApiError` is the typed throw shape;
// recreating a minimal version here keeps the test self-contained
// without pulling network code.
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
  useLearningOutcomesByClassAndSubject,
  type LearningOutcomeDto,
} from "../learning-outcomes";

const mockedApi = api as jest.MockedFunction<typeof api>;

const sampleOutcome: LearningOutcomeDto = {
  id: "ck-test-001",
  classLevel: 4,
  subjectCode: "ENGLISH",
  curriculumVersion: "2083",
  unitNumber: 1,
  unitTitleEn: "Greeting, Introducing and Leave Taking",
  unitTitleNp: null,
  sortOrder: 1,
  skillArea: "LISTENING",
  descriptionEn:
    "Recognise familiar words and basic phrases, and expressions related to themselves.",
  descriptionNp: null,
  createdAt: "2026-05-13T18:21:48.500Z",
};

describe("useLearningOutcomesByClassAndSubject", () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it("returns data on success", async () => {
    mockedApi.mockResolvedValueOnce([sampleOutcome]);

    const { result } = renderHook(
      () => useLearningOutcomesByClassAndSubject(4, "ENGLISH"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([sampleOutcome]);
    // Verifies the URL the hook constructs — protects against a
    // sliently-wrong `?classLevel=` / `?subject=` rename.
    expect(mockedApi).toHaveBeenCalledWith(
      "/learning-outcomes?classLevel=4&subject=ENGLISH",
      expect.objectContaining({ redirectOn403: false }),
    );
  });

  it("returns error on failure (and respects the no-retry-on-4xx policy)", async () => {
    const { ApiError } = jest.requireMock("../api") as {
      ApiError: new (s: number, m: string) => Error;
    };
    // 400 is in the "don't retry" range of the hook's retry policy, so
    // isError settles on the first attempt — no exponential-backoff
    // wait. (5xx would retry once and bust the default 1s waitFor
    // window.) Using 400 also documents that 4xx is a terminal status
    // for this query.
    mockedApi.mockRejectedValueOnce(new ApiError(400, "boom"));

    const { result } = renderHook(
      () => useLearningOutcomesByClassAndSubject(4, "ENGLISH"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("boom");
    // No retry happened — single call.
    expect(mockedApi).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when enabled: false", async () => {
    mockedApi.mockResolvedValue([sampleOutcome]);

    const { result } = renderHook(
      () =>
        useLearningOutcomesByClassAndSubject(4, "ENGLISH", { enabled: false }),
      { wrapper: createWrapper() },
    );

    // Give React Query a tick to spin up if it were going to.
    await new Promise((r) => setTimeout(r, 30));
    expect(mockedApi).not.toHaveBeenCalled();
    // The query is idle, not loading or successful.
    expect(result.current.fetchStatus).toBe("idle");
  });
});
