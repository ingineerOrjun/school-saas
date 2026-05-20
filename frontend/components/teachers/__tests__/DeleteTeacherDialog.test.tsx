import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the api module BEFORE importing anything that uses it. Same
// shape as the DeleteUserDialog tests; the dialog routes its mutation
// through teachersApi.remove → api(`/teachers/${id}`, { method: 'DELETE' }).
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

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

import { api, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { DeleteTeacherDialog } from "../DeleteTeacherDialog";
import type { TeacherDto } from "@/lib/teachers";

const mockedApi = api as jest.MockedFunction<typeof api>;
const mockedToastSuccess = toast.success as jest.MockedFunction<
  typeof toast.success
>;

// ============================================================================
// DeleteTeacherDialog — Session 6c.3 UI contract.
//
// Rewritten from the typed-confirmation shell to match DeleteUserDialog
// exactly. The dialog owns its mutation, surfaces inline errors, and
// fires a success toast on completion. Tests mirror DeleteUserDialog's
// coverage one-for-one so any regression on the user dialog side
// surfaces here too.
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

function makeTeacher(overrides: Partial<TeacherDto> = {}): TeacherDto {
  return {
    id: "teacher-1",
    name: "Mira Thapa",
    schoolId: "school-a",
    userId: "user-teacher-1",
    assignmentCounts: {
      total: 0,
      classes: 0,
      sections: 0,
      subjects: 0,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const NOOP = () => {};

describe("DeleteTeacherDialog (Session 6c.3 — checkbox + dialog-owned mutation)", () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedToastSuccess.mockReset();
  });

  it("renders the target teacher's name when open", () => {
    render(
      <DeleteTeacherDialog
        teacher={makeTeacher({ name: "Ravi Shrestha" })}
        onClose={NOOP}
      />,
      { wrapper },
    );
    expect(screen.getByText("Ravi Shrestha")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /delete teacher/i }),
    ).toBeInTheDocument();
  });

  it("disables the destructive button until the checkbox is checked", () => {
    render(
      <DeleteTeacherDialog teacher={makeTeacher()} onClose={NOOP} />,
      { wrapper },
    );

    const deleteButton = screen.getByRole("button", {
      name: /delete teacher/i,
    });
    expect(deleteButton).toBeDisabled();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(deleteButton).not.toBeDisabled();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(deleteButton).toBeDisabled();
  });

  it("on 409 active-assignments refusal: shows the backend's verbatim message inside the modal and keeps it open", async () => {
    // The backend's 6c.1 message format is "This user has N active
    // teaching assignments. Unassign them before deletion." — the
    // wording mentions "user" not "teacher" because the message
    // comes from UserService.softDelete. We surface it verbatim per
    // the locked design decision (Session 6c.2 + 6c.3): the
    // backend's copy is already operator-friendly and includes the
    // count, so paraphrasing would lose information.
    const backendMessage =
      "This user has 3 active teaching assignments. Unassign them before deletion.";
    mockedApi.mockRejectedValueOnce(new ApiError(409, backendMessage));

    const onClose = jest.fn();
    const onSuccess = jest.fn();

    render(
      <DeleteTeacherDialog
        teacher={makeTeacher()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete teacher/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(backendMessage);

    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockedToastSuccess).not.toHaveBeenCalled();
  });

  it("on success (204 NO_CONTENT): closes the modal, calls onSuccess, and surfaces a success toast", async () => {
    // The backend route returns 204; the `api()` helper resolves to
    // undefined for empty responses. The dialog should still
    // navigate through the success branch.
    mockedApi.mockResolvedValueOnce(undefined);

    const onClose = jest.fn();
    const onSuccess = jest.fn();

    render(
      <DeleteTeacherDialog
        teacher={makeTeacher()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete teacher/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mockedToastSuccess).toHaveBeenCalledWith("Teacher deactivated");

    // The DELETE actually fired against the right URL.
    expect(mockedApi).toHaveBeenCalledWith("/teachers/teacher-1", {
      method: "DELETE",
    });
  });

  it("when teacher is null: nothing renders", () => {
    render(
      <DeleteTeacherDialog teacher={null} onClose={NOOP} />,
      { wrapper },
    );
    expect(
      screen.queryByRole("heading", { name: /delete teacher/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("on 403: shows the rewritten 'no permission' message (not the raw backend text)", async () => {
    mockedApi.mockRejectedValueOnce(
      new ApiError(403, "You cannot delete this user."),
    );

    render(
      <DeleteTeacherDialog teacher={makeTeacher()} onClose={NOOP} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete teacher/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You don't have permission to delete this teacher.",
    );
  });
});
