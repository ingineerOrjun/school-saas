"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FilePlus2,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { academicSessionsApi } from "@/lib/academic-sessions";
import { getStoredUser, type Role, type SafeUser } from "@/lib/auth";
import { examsApi, type ExamSubjectDto } from "@/lib/exams";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

/**
 * Create-exam page — `/exams/create`.
 *
 * Single-page form: type the exam name, add a row per subject (theory
 * full marks + optional practical full marks), click "Create Exam"
 * once. The submit handler creates the exam first (POST /exams), then
 * adds each subject row in sequence (POST /exams/:id/subjects). On
 * full success the page navigates to `/exams/marks` so the admin can
 * immediately start entering marks.
 *
 * Role gate is client-side only ("if user.role is ADMIN/STAFF" — both
 * can create exams per the backend's `@Roles(Role.ADMIN, Role.STAFF)`
 * decorator). The backend re-enforces; the gate is purely UX so
 * teachers / parents who land here see a friendly "restricted" panel
 * instead of a broken form.
 */
const ALLOWED_ROLES: Role[] = ["ADMIN", "STAFF"];

interface DraftSubject {
  /** Stable client-side id so React key changes don't reset rows. */
  uid: string;
  name: string;
  theoryFullMarks: string; // string in state so empty fields don't read as 0
  practicalFullMarks: string;
}

const newDraft = (): DraftSubject => ({
  uid: cryptoRandom(),
  name: "",
  theoryFullMarks: "100",
  practicalFullMarks: "0",
});

function cryptoRandom(): string {
  // crypto.randomUUID isn't available in older targets; fallback to
  // Math.random for these client-only stable keys (collisions don't
  // matter since the values never leave the page).
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export default function CreateExamPage() {
  const router = useRouter();
  const [user, setUser] = React.useState<SafeUser | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  // ----- Form state -----
  const [name, setName] = React.useState("");
  const [subjects, setSubjects] = React.useState<DraftSubject[]>([newDraft()]);
  const [submitting, setSubmitting] = React.useState(false);
  // When the backend rejects the create with "No active academic
  // session," we surface a sticky inline panel instead of just a
  // toast — admins need a one-click path to fix it (either auto-
  // create a default session right here, or jump to the Settings
  // page for full control). Cleared on next submit attempt.
  const [needsActiveSession, setNeedsActiveSession] = React.useState(false);
  const [creatingSession, setCreatingSession] = React.useState(false);

  React.useEffect(() => {
    setUser(getStoredUser());
    setHydrated(true);
  }, []);

  // ----- Role gate -----
  if (!hydrated) return <PageSkeleton />;
  if (!user) {
    // Layout's auth gate should have caught this — defensive.
    router.replace("/login");
    return <PageSkeleton />;
  }
  if (!ALLOWED_ROLES.includes(user.role)) {
    return <RestrictedPanel role={user.role} />;
  }

  // ----- Helpers -----
  const updateSubject = (uid: string, patch: Partial<DraftSubject>) => {
    setSubjects((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
    );
  };

  const addSubjectRow = () => {
    setSubjects((prev) => [...prev, newDraft()]);
  };

  const removeSubjectRow = (uid: string) => {
    setSubjects((prev) =>
      prev.length === 1
        ? // Always keep one row visible; clearing it instead is closer
          // to the user's intent than vanishing the form.
          [{ ...prev[0], name: "", theoryFullMarks: "100", practicalFullMarks: "0" }]
        : prev.filter((s) => s.uid !== uid),
    );
  };

  // ----- Validation -----
  // Subjects with no name are SKIPPED on submit (treated as empty
  // placeholders). Validation focuses on actually-named rows so an
  // admin can leave a trailing empty row without it blocking save.
  const namedSubjects = subjects.filter((s) => s.name.trim() !== "");
  const validationError = (() => {
    if (name.trim().length === 0) return "Exam name is required.";
    if (namedSubjects.length === 0)
      return "Add at least one subject (give it a name).";
    for (const s of namedSubjects) {
      const theory = Number(s.theoryFullMarks);
      const practical = Number(s.practicalFullMarks);
      if (!Number.isFinite(theory) || theory <= 0 || theory > 1000) {
        return `"${s.name}": theory full marks must be between 1 and 1000.`;
      }
      if (!Number.isFinite(practical) || practical < 0 || practical > 1000) {
        return `"${s.name}": practical full marks must be between 0 and 1000.`;
      }
    }
    // Catch duplicate subject names (case-insensitive) — the backend
    // would 409 anyway but pre-flagging keeps the round-trips down.
    const seen = new Set<string>();
    for (const s of namedSubjects) {
      const key = s.name.trim().toLowerCase();
      if (seen.has(key)) return `Duplicate subject name: "${s.name}".`;
      seen.add(key);
    }
    return null;
  })();

  const canSubmit = !submitting && validationError === null;

  // ----- One-click "create default session" -----
  // Spins up a sensible default academic session and marks it active,
  // so the admin doesn't have to leave the Create Exam flow just to
  // satisfy the backend's "exams must belong to an active session"
  // requirement. Defaults to the current calendar year (e.g.,
  // "2026-27" Jan 1 → Dec 31). Admins can rename / edit dates later
  // from /settings/sessions if they want a fiscal-year shape.
  const handleCreateDefaultSession = async () => {
    setCreatingSession(true);
    try {
      const now = new Date();
      const year = now.getFullYear();
      const nextYearShort = (year + 1).toString().slice(-2);
      await academicSessionsApi.create({
        name: `${year}-${nextYearShort}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        isActive: true,
      });
      setNeedsActiveSession(false);
      toast.success(
        `Created and activated session "${year}-${nextYearShort}". You can now save the exam.`,
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to create academic session.";
      toast.error(msg);
    } finally {
      setCreatingSession(false);
    }
  };

  // ----- Submit -----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setNeedsActiveSession(false);
    let createdExamId: string | null = null;
    let addedCount = 0;
    try {
      // 1. Create the exam shell.
      const exam = await examsApi.create({ name: name.trim() });
      createdExamId = exam.id;

      // 2. Add each subject in sequence. Sequential (not parallel) so
      //    a failure halfway through doesn't mask an earlier success
      //    in toast noise — and the order matches what the admin
      //    typed on screen.
      const created: ExamSubjectDto[] = [];
      for (const s of namedSubjects) {
        const row = await examsApi.addSubject(exam.id, {
          name: s.name.trim(),
          theoryFullMarks: Number(s.theoryFullMarks),
          practicalFullMarks: Number(s.practicalFullMarks) || 0,
        });
        created.push(row);
        addedCount = created.length;
      }

      toast.success(
        `Created "${exam.name}" with ${addedCount} subject${addedCount === 1 ? "" : "s"}.`,
      );
      // Land on the marks-entry page so the admin can immediately
      // grade students against the exam they just made. Hard nav so
      // any cached exam list elsewhere is forced to re-pull.
      window.location.assign("/exams/marks");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to create exam.";

      // Special-case the "no active academic session" backend error
      // (BadRequestException from AcademicSessionService.requireActiveUnlocked).
      // Without an active session, exam creation is structurally
      // blocked — toast alone doesn't tell the admin how to fix it,
      // so flip a flag that renders a sticky banner with a direct
      // link to /settings/sessions.
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        msg.toLowerCase().includes("active academic session")
      ) {
        setNeedsActiveSession(true);
      } else if (createdExamId && addedCount < namedSubjects.length) {
        // Distinguish "exam created, some subjects failed" from "exam
        // creation failed entirely" so the admin knows whether to retry
        // from scratch or just edit the partial exam.
        toast.error(
          `Exam created but ${namedSubjects.length - addedCount} subject(s) failed: ${msg}. You can finish adding them from the exam page.`,
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Header />

      <form
        onSubmit={handleSubmit}
        className="space-y-6"
        // Block native form submission via Enter on text inputs from
        // accidentally firing before the button — Enter is too easy
        // to hit while typing in the subject grid.
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") {
            e.preventDefault();
          }
        }}
      >
        {/* ---------- Exam name ---------- */}
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FilePlus2 className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Exam details
            </h2>
          </div>
          <Input
            label="Exam name"
            placeholder="Term 1 — 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
            disabled={submitting}
            hint="A short label admins and teachers will see in dropdowns. E.g., 'Mid-Term', 'Final 2026'."
          />
        </section>

        {/* ---------- Subjects ---------- */}
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
                <BookOpen className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Subjects
                </h2>
                <p className="text-xs text-muted-foreground">
                  One row per subject with its full-marks split. Leave
                  Practical at 0 for theory-only subjects.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSubjectRow}
              disabled={submitting}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Add row
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30">
                  <Th className="w-10 text-center">#</Th>
                  <Th>Subject name</Th>
                  <Th className="w-[140px]">Theory full marks</Th>
                  <Th className="w-[140px]">Practical full marks</Th>
                  <Th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {subjects.map((s, idx) => (
                  <tr
                    key={s.uid}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <Td className="text-center text-xs text-muted-foreground tabular-nums">
                      {idx + 1}
                    </Td>
                    <Td>
                      <input
                        type="text"
                        placeholder="Mathematics"
                        value={s.name}
                        onChange={(e) =>
                          updateSubject(s.uid, { name: e.target.value })
                        }
                        disabled={submitting}
                        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
                      />
                    </Td>
                    <Td>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={s.theoryFullMarks}
                        onChange={(e) =>
                          updateSubject(s.uid, {
                            theoryFullMarks: e.target.value.replace(/[^0-9]/g, ""),
                          })
                        }
                        disabled={submitting}
                        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
                      />
                    </Td>
                    <Td>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={s.practicalFullMarks}
                        onChange={(e) =>
                          updateSubject(s.uid, {
                            practicalFullMarks: e.target.value.replace(/[^0-9]/g, ""),
                          })
                        }
                        disabled={submitting}
                        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
                      />
                    </Td>
                    <Td className="text-center">
                      <button
                        type="button"
                        onClick={() => removeSubjectRow(s.uid)}
                        disabled={submitting}
                        aria-label="Remove subject row"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors focus-ring"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {needsActiveSession && (
          // Sticky banner shown when the backend's
          // `requireActiveUnlocked` check rejected the create.
          // Offers TWO recovery paths so the admin doesn't have to
          // context-switch:
          //   • One-click "Set up a default session" — creates a
          //     session named "<thisYear>-<nextYearShort>" with
          //     calendar-year dates and marks it active. Resolves
          //     the prerequisite right here so the admin can hit
          //     Save again immediately.
          //   • "Open Academic Sessions" — full Settings page for
          //     custom names / dates / multiple sessions.
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  No active academic session
                </p>
                <p className="text-xs text-amber-900/80 dark:text-amber-200/80 max-w-2xl">
                  Exams are scoped to a school year. Either spin up a
                  default session in one click, or open the Settings
                  page to configure a custom one. Every exam,
                  attendance row, and result is filed under the active
                  session.
                </p>
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreateDefaultSession}
                    loading={creatingSession}
                    disabled={creatingSession || submitting}
                  >
                    Set up a default session
                  </Button>
                  <Link
                    href="/settings/sessions"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-100/60 dark:bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-100",
                      "transition-all hover:bg-amber-200/70 hover:-translate-y-px",
                      "focus-ring",
                    )}
                  >
                    Configure manually
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {validationError && (
          <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            {validationError}
          </div>
        )}

        {/* ---------- Footer actions ---------- */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/exams/marks"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-ring rounded-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to marks entry
          </Link>
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={!canSubmit}
              loading={submitting}
              leftIcon={
                !submitting ? <CheckCircle2 className="h-4 w-4" /> : undefined
              }
            >
              Create exam
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Create exam
      </h1>
      <p className="text-sm text-muted-foreground">
        Set the exam name and subject list in one go. After saving you
        can enter marks for the whole class from the marks-entry grid.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Restricted state — non-admin / non-staff visitors
// ---------------------------------------------------------------------------

function RestrictedPanel({ role }: { role: Role }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <Header />
      <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 p-6 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Restricted to admins and staff
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            Creating exams is an admin / staff workflow. Your account is
            signed in as <span className="font-medium">{role}</span>.
            If you need an exam set up, ask your school admin to create
            it from this page.
          </p>
          <div className="pt-2">
            <Link
              href="/exams/marks"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground",
                "transition-all hover:border-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-700",
                "focus-ring",
              )}
            >
              Go to marks entry
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "h-9 px-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-2.5 py-2 align-middle border-b border-border/60",
        className,
      )}
    >
      {children}
    </td>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-3 w-96" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
