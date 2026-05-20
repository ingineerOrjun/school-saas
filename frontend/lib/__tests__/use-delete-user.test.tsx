import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

// Mock the api module BEFORE importing anything that uses it. Same
// pattern as continuous-records-mutation.test.tsx; the ApiError shape
// is recreated minimally because the real one lives behind toast +
// localStorage side effects.
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
import { useDeleteUser, type DeactivatedUserDto } from "../users";

const mockedApi = api as jest.MockedFunction<typeof api>;

function wrapperWithClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, Wrapper };
}

const DELETED_USER: DeactivatedUserDto = {
  id: "user-1",
  email: "victim@school.test",
  role: "TEACHER",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-05-19T12:00:00.000Z",
  deletedAt: "2026-05-19T12:00:00.000Z",
};

// ============================================================================
// useDeleteUser — Session 6c.2 hook contract.
//
// Covers:
//   1. Calls DELETE /users/:id with no body.
//   2. On success: invalidates qk.users() so any consumer refetches.
//   3. retry: false — a refusal (409) lands once, not 4x.
// ============================================================================

describe("useDeleteUser", () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it("calls DELETE /users/:id and returns the deactivated row", async () => {
    mockedApi.mockResolvedValueOnce(DELETED_USER);
    const { Wrapper } = wrapperWithClient();

    const { result } = renderHook(() => useDeleteUser(), {
      wrapper: Wrapper,
    });
    result.current.mutate("user-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi).toHaveBeenCalledTimes(1);
    expect(mockedApi).toHaveBeenCalledWith("/users/user-1", {
      method: "DELETE",
    });
    expect(result.current.data).toEqual(DELETED_USER);
  });

  it("invalidates qk.users() on success so future consumers refetch", async () => {
    mockedApi.mockResolvedValueOnce(DELETED_USER);
    const { client, Wrapper } = wrapperWithClient();

    // Seed a fake users-query slot so we can observe its invalidation.
    // The cache slot is marked fresh by setQueryData; invalidation
    // should flip its `isInvalidated` flag.
    client.setQueryData(qk.users(), [DELETED_USER]);
    const stateBefore = client
      .getQueryCache()
      .find({ queryKey: qk.users() })
      ?.state;
    expect(stateBefore?.isInvalidated).toBe(false);

    const { result } = renderHook(() => useDeleteUser(), {
      wrapper: Wrapper,
    });
    result.current.mutate("user-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const stateAfter = client
      .getQueryCache()
      .find({ queryKey: qk.users() })
      ?.state;
    expect(stateAfter?.isInvalidated).toBe(true);
  });

  it("does NOT retry on a 409 refusal (active assignments)", async () => {
    const { ApiError } = jest.requireMock("../api") as {
      ApiError: new (s: number, m: string) => Error;
    };
    mockedApi.mockRejectedValueOnce(
      new ApiError(
        409,
        "This user has 2 active teaching assignments. Unassign them before deletion.",
      ),
    );
    const { Wrapper } = wrapperWithClient();

    const { result } = renderHook(() => useDeleteUser(), {
      wrapper: Wrapper,
    });
    result.current.mutate("user-1");

    await waitFor(() => expect(result.current.isError).toBe(true));

    // The mutation fired exactly once — no auto-retry stomped the
    // operator's intent. retry: false is the contract.
    expect(mockedApi).toHaveBeenCalledTimes(1);
    expect((result.current.error as Error).message).toMatch(
      /2 active teaching assignments/,
    );
  });
});
