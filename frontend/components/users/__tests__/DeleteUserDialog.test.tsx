import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the api module BEFORE importing anything that uses it. Same
// shape as the other lib/component tests in this repo.
jest.mock("@/lib/api", () => {
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

// Spy on sonner's toast surface. The dialog calls toast.success on
// successful deletion; we want to assert it without booting the real
// toaster (which expects a Provider mounted in the tree).
jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { DeleteUserDialog } from "../DeleteUserDialog";
import type { UserDto } from "@/lib/users";

const mockedApi = api as jest.MockedFunction<typeof api>;
const mockedToastSuccess = toast.success as jest.MockedFunction<
  typeof toast.success
>;

// ============================================================================
// DeleteUserDialog — Session 6c.2 UI contract.
//
// Covers:
//   1. Renders the target user's email so the operator can confirm
//      who they're about to deactivate.
//   2. The destructive button is disabled until the checkbox is
//      checked (locked design: checkbox-confirm, no type-to-confirm).
//   3. A 409 from the backend surfaces VERBATIM inside the dialog
//      (not paraphrased, not toasted) so the active-assignments
//      count is readable next to the action that triggered it.
//   4. A 200 success closes the modal, calls onSuccess, and shows
//      a success toast.
//   5. user=null hides the dialog entirely — proxy for "no row
//      action → no modal mount" (the row-action gate itself lives
//      in the settings page; the dialog enforces null=hidden).
// ============================================================================

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

function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: "user-1",
    email: "victim@school.test",
    role: "TEACHER",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const NOOP = () => {};

describe("DeleteUserDialog", () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedToastSuccess.mockReset();
  });

  it("renders the target user's email when open", () => {
    render(
      <DeleteUserDialog
        user={makeUser({ email: "alice@school.test" })}
        onClose={NOOP}
      />,
      { wrapper },
    );
    expect(screen.getByText("alice@school.test")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /delete user/i }),
    ).toBeInTheDocument();
  });

  it("disables the destructive button until the checkbox is checked", () => {
    render(
      <DeleteUserDialog user={makeUser()} onClose={NOOP} />,
      { wrapper },
    );

    const deleteButton = screen.getByRole("button", {
      name: /delete user/i,
    });
    expect(deleteButton).toBeDisabled();

    // Tick the checkbox — the button should enable.
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(deleteButton).not.toBeDisabled();

    // Untick — button disables again.
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(deleteButton).toBeDisabled();
  });

  it("on 409 active-assignments refusal: shows the backend's verbatim message inside the modal and keeps it open", async () => {
    const backendMessage =
      "This user has 3 active teaching assignments. Unassign them before deletion.";
    mockedApi.mockRejectedValueOnce(new ApiError(409, backendMessage));

    const onClose = jest.fn();
    const onSuccess = jest.fn();

    render(
      <DeleteUserDialog
        user={makeUser()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete user/i }));

    // Backend message lands verbatim — no paraphrase, no truncation.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(backendMessage);

    // Dialog stays open (no onClose) and onSuccess never fires.
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockedToastSuccess).not.toHaveBeenCalled();
  });

  it("on success: closes the modal, calls onSuccess, and surfaces a success toast", async () => {
    mockedApi.mockResolvedValueOnce({
      id: "user-1",
      email: "victim@school.test",
      role: "TEACHER",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-05-19T12:00:00.000Z",
      deletedAt: "2026-05-19T12:00:00.000Z",
    });

    const onClose = jest.fn();
    const onSuccess = jest.fn();

    render(
      <DeleteUserDialog
        user={makeUser()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete user/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mockedToastSuccess).toHaveBeenCalledWith("User deactivated");
  });

  it("when user is null: nothing renders (proxy for the row-action gate hiding the dialog)", () => {
    render(
      <DeleteUserDialog user={null} onClose={NOOP} />,
      { wrapper },
    );
    // The Modal returns null when not opened; no heading is rendered.
    expect(
      screen.queryByRole("heading", { name: /delete user/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("on 403: shows the rewritten 'no permission' message (not the raw backend text)", async () => {
    // 403 deliberately gets a tone-matched rewrite — the backend's
    // message is fine for security but the operator-facing copy
    // reads more naturally as "You don't have permission..."
    mockedApi.mockRejectedValueOnce(
      new ApiError(403, "You cannot delete this user."),
    );

    render(
      <DeleteUserDialog user={makeUser()} onClose={NOOP} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete user/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You don't have permission to delete this user.",
    );
  });
});
