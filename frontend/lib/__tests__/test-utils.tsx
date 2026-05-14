import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

// ============================================================================
// Shared test utilities for React Query-backed hook tests.
//
// Every hook in this codebase calls `useQuery`, which in turn requires
// a `QueryClientProvider` in the tree. The pattern below is the
// canonical recipe from the @tanstack/react-query docs:
//
//   • One fresh QueryClient per test, so mutations / cache state from
//     one test never leak into another.
//   • `retry: false` — tests that exercise the error path don't need
//     to wait for the default 3-retry exponential backoff.
//   • `gcTime: Infinity` is NOT set; the per-test client is discarded
//     on test teardown anyway.
//
// Usage:
//
//   import { renderHook, waitFor } from "@testing-library/react";
//   import { createWrapper } from "@/lib/__tests__/test-utils";
//
//   const { result } = renderHook(() => useMyHook(...), {
//     wrapper: createWrapper(),
//   });
//   await waitFor(() => expect(result.current.isSuccess).toBe(true));
// ============================================================================
export function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
