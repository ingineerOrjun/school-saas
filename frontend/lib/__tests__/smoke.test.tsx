import { renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { createWrapper } from "./test-utils";

// ============================================================================
// Smoke test — confirms the Session 6a test infrastructure works end-to-end.
//
// What this exercises:
//   • Jest + next/jest SWC transform of TSX
//   • jsdom environment (otherwise React's render path crashes)
//   • @testing-library/react renderHook + waitFor
//   • @tanstack/react-query's QueryClientProvider wrapper pattern
//
// If this file ever fails, every other hook test in this codebase will
// fail too — fix the infra here first before debugging individual hooks.
// ============================================================================

describe("test infrastructure smoke", () => {
  it("renders a hook through the QueryClientProvider wrapper", async () => {
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["smoke"],
          queryFn: () => Promise.resolve({ ok: true }),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ok: true });
  });
});
