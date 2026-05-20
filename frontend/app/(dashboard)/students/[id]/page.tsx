"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CakeSlice,
  CalendarCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  Hash,
  Info,
  Loader2,
  MapPin,
  Phone,
  ReceiptText,
  RotateCw,
  ShieldAlert,
  User as UserIcon,
  UserSquare2,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { useStudent, type StudentDto } from "@/lib/students";
import {
  useStudentAttendanceReport,
  type AttendanceReport,
  type StudentAttendanceReport,
} from "@/lib/attendance";
import { useStudentFees, type StudentFeesReport } from "@/lib/fees";
import { formatCurrency } from "@/lib/currency";
import {
  useExams,
  useStudentExamResults,
  type ExamDto,
  type StudentReport,
} from "@/lib/exams";
import {
  useContinuousRecordsForStudent,
  type ContinuousRecordDto,
} from "@/lib/continuous-records";
import { useLearningOutcomesByClassAndSubject } from "@/lib/learning-outcomes";
import { useAcademicSession } from "@/components/academic-session/AcademicSessionProvider";
import { extractClassLevel } from "@/lib/class-level";
import { DualDate } from "@/components/calendar/DualDate";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import type { SubjectCode } from "@/lib/subject-aliases";
import { cn } from "@/lib/utils";

// ============================================================================
// /students/[id] — consolidated student-detail page (Session 6c-detail).
//
// Six sections, each independent: identity, academic, attendance, fees,
// CDC ratings, exam scores. Sections fan out in parallel and render as
// data arrives — a slow fees query doesn't block the attendance section.
//
// Read-only. Editing lives on the existing /students list + dialogs.
//
// Role gating: TEACHER + STAFF + ADMIN + SUPER_ADMIN all reach the page
// (backend's /students/:id has no role gate at the controller — just
// JwtAuthGuard via StudentController). The Fees section degrades for
// non-admin viewers because /fees/student/:id is ADMIN-only on the
// server; the section renders a "requires admin role" inline note
// instead of an error banner.
// ============================================================================

const ALL_SUBJECT_CODES: ReadonlyArray<SubjectCode> = [
  "NEPALI",
  "ENGLISH",
  "MATHEMATICS",
  "SCIENCE_TECHNOLOGY",
  "SOCIAL_STUDIES",
  "HEALTH_PHYSICAL",
  "ARTS_EDUCATION",
];

const SUBJECT_DISPLAY_NAME: Record<SubjectCode, string> = {
  NEPALI: "Nepali",
  ENGLISH: "English",
  MATHEMATICS: "Mathematics",
  SCIENCE_TECHNOLOGY: "Science & Technology",
  SOCIAL_STUDIES: "Social Studies",
  HEALTH_PHYSICAL: "Health & Physical Education",
  ARTS_EDUCATION: "Arts Education",
};

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  // Role of the viewer drives the Fees section's "enabled" gate. Read
  // once on mount via getStoredUser (same pattern as /settings) — the
  // role doesn't change mid-session without a re-login.
  const [viewerRole, setViewerRole] = React.useState<string | null>(null);
  React.useEffect(() => {
    setViewerRole(getStoredUser()?.role ?? null);
  }, []);
  const isAdminViewer =
    viewerRole === "ADMIN" || viewerRole === "SUPER_ADMIN";

  const studentQuery = useStudent(id);

  // 401 → already redirected by api.ts. Other auth failures bubble to
  // the section error states. A 404 on the student itself surfaces
  // the full-page "not found" state below.
  React.useEffect(() => {
    if (
      studentQuery.error instanceof ApiError &&
      studentQuery.error.status === 401
    ) {
      router.replace("/login");
    }
  }, [studentQuery.error, router]);

  // ------------------------------------------------------------------------
  // Full-page states.
  // ------------------------------------------------------------------------

  if (studentQuery.isLoading) {
    return <PageSkeleton />;
  }
  if (
    studentQuery.error instanceof ApiError &&
    studentQuery.error.status === 404
  ) {
    return <NotFoundPanel />;
  }
  if (studentQuery.isError) {
    return (
      <RetryPanel
        message={
          studentQuery.error instanceof ApiError
            ? studentQuery.error.message
            : "Failed to load student."
        }
        onRetry={() => studentQuery.refetch()}
      />
    );
  }
  const student = studentQuery.data;
  if (!student) {
    // Defensive — `isLoading=false, isError=false, data=undefined` is
    // technically possible during a transition. Surface as not-found
    // rather than a blank page.
    return <NotFoundPanel />;
  }

  // ------------------------------------------------------------------------
  // Render — header + six section cards.
  // ------------------------------------------------------------------------

  const fullName = `${student.firstName} ${student.lastName}`.trim();

  return (
    <div className="space-y-6">
      <Header student={student} fullName={fullName} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <IdentitySection student={student} />
        <AcademicSection student={student} />
      </div>

      <AttendanceSection studentId={student.id} />

      <FeesSection studentId={student.id} isAdminViewer={isAdminViewer} />

      <CdcSection student={student} />

      <ExamScoresSection studentId={student.id} />
    </div>
  );
}

// ===========================================================================
// Header
// ===========================================================================

function Header({
  student,
  fullName,
}: {
  student: StudentDto;
  fullName: string;
}) {
  const className = student.class?.name ?? student.section?.class.name ?? null;
  const sectionName = student.section?.name ?? null;
  return (
    <div className="space-y-4 animate-fade-in-up">
      <Link
        href="/students"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Students
      </Link>

      {/* Hero header: gradient avatar to the left, name + chips to
          the right. Subtle bottom border serves as the visual anchor
          that separates the header from the section cards below.
          Mobile: avatar + name stack vertically on very narrow widths;
          chips wrap. */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center">
        <StudentAvatar
          firstName={student.firstName}
          lastName={student.lastName}
          id={student.id}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {fullName}
            </h1>
            {student.symbolNumber && (
              <span
                className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground tabular-nums"
                title="Roll / symbol number"
              >
                <Hash className="h-3 w-3" />
                {student.symbolNumber}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {className && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
                <GraduationCap className="h-3.5 w-3.5" />
                {className}
                {sectionName ? ` · ${sectionName}` : ""}
              </span>
            )}
            {student.archivedAt ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-inset ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
                Archived
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-800 ring-1 ring-inset ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
                Active
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline gradient avatar. Mirrors the StudentTable's Avatar component
// one-for-one (same palette set, same deterministic hash) so a student's
// avatar reads identically across the list view and the detail page.
// Sized larger here (h-14 w-14) than the table version (h-9 w-9) — the
// detail page is the canonical "this student" surface.
// ---------------------------------------------------------------------------

const STUDENT_AVATAR_PALETTES = [
  "from-indigo-400 to-purple-400",
  "from-sky-400 to-blue-400",
  "from-emerald-400 to-teal-400",
  "from-amber-400 to-orange-400",
  "from-pink-400 to-rose-400",
  "from-violet-400 to-fuchsia-400",
] as const;

function paletteForId(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return STUDENT_AVATAR_PALETTES[sum % STUDENT_AVATAR_PALETTES.length];
}

function StudentAvatar({
  firstName,
  lastName,
  id,
}: {
  firstName: string;
  lastName: string;
  id: string;
}) {
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  return (
    <div
      className={cn(
        "flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white shadow-sm ring-2 ring-inset ring-white/30",
        `bg-gradient-to-br ${paletteForId(id)}`,
      )}
      aria-hidden
    >
      {initials}
    </div>
  );
}

// ===========================================================================
// Section 1 — Identity
// ===========================================================================

function IdentitySection({ student }: { student: StudentDto }) {
  const age = computeAge(student.dateOfBirth);
  return (
    <SectionCard icon={<UserIcon className="h-5 w-5" />} title="Identity">
      <div className="space-y-5">
        {/* Personal — DOB + gender. Visually grouped from contact via
            a thin divider; reads as one identity-card "block". */}
        <div className="space-y-1">
          <SubsectionLabel>Personal</SubsectionLabel>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <IconField
              icon={<CakeSlice className="h-3.5 w-3.5" />}
              label="Date of birth"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <DualDate date={student.dateOfBirth} />
                  {age !== null && (
                    <span className="text-xs text-muted-foreground">
                      · {age} yrs
                    </span>
                  )}
                </span>
              }
            />
            <IconField
              icon={<UserSquare2 className="h-3.5 w-3.5" />}
              label="Gender"
              value={titleCase(student.gender)}
            />
          </dl>
        </div>

        <div className="border-t border-border/40" />

        {/* Contact — parent, phone, address. Address spans both columns
            because addresses are typically multi-line. */}
        <div className="space-y-1">
          <SubsectionLabel>Contact</SubsectionLabel>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <IconField
              icon={<UserIcon className="h-3.5 w-3.5" />}
              label="Parent / guardian"
              value={student.parentName}
              fallback="No guardian on file"
            />
            <IconField
              icon={<Phone className="h-3.5 w-3.5" />}
              label="Contact number"
              value={
                student.contactNumber ? (
                  <span className="tabular-nums">{student.contactNumber}</span>
                ) : null
              }
              fallback="No contact number"
            />
            <IconField
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="Address"
              value={
                student.address ? (
                  <span className="whitespace-pre-wrap leading-snug">
                    {student.address}
                  </span>
                ) : null
              }
              fallback="No address on file"
              full
            />
          </dl>
        </div>
      </div>
    </SectionCard>
  );
}

// ===========================================================================
// Section 2 — Academic
// ===========================================================================

function AcademicSection({ student }: { student: StudentDto }) {
  const { selected } = useAcademicSession();
  const className =
    student.class?.name ?? student.section?.class.name ?? null;
  const sectionName = student.section?.name ?? null;
  const isArchived = Boolean(student.archivedAt);
  return (
    <SectionCard
      icon={<GraduationCap className="h-5 w-5" />}
      title="Academic"
    >
      <div className="space-y-4">
        {/* Class + section as visual chips, side-by-side. Reads as
            "this is where the student belongs" at a glance. */}
        <div className="flex flex-wrap gap-2">
          {className ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary ring-1 ring-inset ring-primary/20">
              <GraduationCap className="h-3.5 w-3.5" />
              {className}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2.5 py-1 text-sm font-medium text-muted-foreground ring-1 ring-inset ring-border">
              Unassigned
            </span>
          )}
          {sectionName && (
            <span className="inline-flex items-center rounded-md bg-sky-100 px-2.5 py-1 text-sm font-semibold text-sky-800 ring-1 ring-inset ring-sky-300/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30">
              Section {sectionName}
            </span>
          )}
          {/* Status pill mirrors the header's so the operator can scan
              either surface and get the same signal. */}
          {isArchived ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-inset ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
              Archived
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-800 ring-1 ring-inset ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
              Active
            </span>
          )}
        </div>

        {/* Current session — featured as the academic anchor with a
            calendar icon. Admission date is secondary, smaller text. */}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <IconField
            icon={<CalendarCheck className="h-3.5 w-3.5" />}
            label="Current session"
            value={
              selected?.name ? (
                <span className="font-medium text-foreground">
                  {selected.name}
                </span>
              ) : null
            }
            fallback="No active session"
          />
          <IconField
            icon={<CalendarCheck className="h-3.5 w-3.5" />}
            label="Admission date"
            value={
              student.admissionDate ? (
                <DualDate date={student.admissionDate} />
              ) : null
            }
            fallback="Not recorded"
          />
          {isArchived && student.archiveReason && (
            <IconField
              icon={<Info className="h-3.5 w-3.5" />}
              label="Archived reason"
              value={
                <span className="italic text-muted-foreground">
                  {student.archiveReason}
                </span>
              }
              full
            />
          )}
        </dl>
      </div>
    </SectionCard>
  );
}

// ===========================================================================
// Section 3 — Attendance
// ===========================================================================

function AttendanceSection({ studentId }: { studentId: string }) {
  const { selected } = useAcademicSession();
  const fromDate = selected?.startDate ?? null;
  const toDate = selected?.endDate ?? null;

  const reportQuery = useStudentAttendanceReport(studentId, {
    fromDate: fromDate ?? "",
    toDate: toDate ?? "",
    sessionId: selected?.id ?? null,
    enabled: Boolean(fromDate) && Boolean(toDate),
  });

  return (
    <SectionCard
      icon={<CalendarCheck className="h-5 w-5" />}
      title="Attendance this session"
      subtitle={
        selected ? `${selected.name}` : "Select an academic session"
      }
    >
      {!selected ? (
        <p className="text-sm italic text-muted-foreground">
          No active academic session — attendance summary unavailable.
        </p>
      ) : reportQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : reportQuery.isError ? (
        <SectionError
          message={
            reportQuery.error instanceof ApiError
              ? reportQuery.error.message
              : "Failed to load attendance."
          }
          onRetry={() => reportQuery.refetch()}
        />
      ) : (
        <AttendanceStats report={reportQuery.data} session={selected} />
      )}
    </SectionCard>
  );
}

function AttendanceStats({
  report,
  session,
}: {
  report: AttendanceReport | undefined;
  session: { startDate: string; endDate: string };
}) {
  // The backend returns a discriminated union; for the student-scoped
  // call we narrow defensively. Other scopes are a programmer error
  // we surface as "—" rather than a runtime throw.
  const scoped: StudentAttendanceReport | null =
    report && report.scope === "student" ? report : null;
  const present = scoped?.presentDays ?? 0;
  const absent = scoped?.absentDays ?? 0;
  const total = scoped?.totalDays ?? 0;
  const pct = scoped?.percentage ?? null;

  // Days remaining is computed from the session's endDate; this is a
  // calendar count, NOT a school-day count (we don't have the school's
  // calendar of working days), so it overstates working days
  // proportionally. Render as informational, not "school days left".
  const daysRemaining = computeDaysRemaining(session.endDate);

  const tier: "high" | "mid" | "low" | "none" =
    total === 0 || pct === null
      ? "none"
      : pct >= 90
        ? "high"
        : pct >= 75
          ? "mid"
          : "low";

  const heroTone = {
    high: "text-emerald-700 dark:text-emerald-400",
    mid: "text-amber-700 dark:text-amber-400",
    low: "text-destructive",
    none: "text-muted-foreground",
  }[tier];

  const barTone = {
    high: "bg-emerald-500",
    mid: "bg-amber-500",
    low: "bg-destructive",
    none: "bg-muted-foreground/40",
  }[tier];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
      {/* Hero tile — percentage as the visual anchor. Larger type,
          tier-keyed color, a thin progress bar underneath so the
          number isn't the only signal. */}
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/40 to-muted/10 p-5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Attendance
        </div>
        <div className={cn("mt-1 text-4xl font-semibold tabular-nums", heroTone)}>
          {pct === null || total === 0 ? "—" : `${pct.toFixed(1)}%`}
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
          <div
            className={cn("h-full rounded-full transition-all", barTone)}
            style={{
              width:
                pct === null
                  ? "0%"
                  : `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`,
            }}
          />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {total === 0
            ? "No attendance recorded this session yet."
            : `Across ${total} school ${total === 1 ? "day" : "days"} recorded`}
        </div>
      </div>

      {/* Supporting metrics — present, absent, days left. Each tile is
          the same shape but each value has a meaningful tone (green
          for the "good" number, amber when absences exist). */}
      <div className="grid grid-cols-3 gap-3">
        <MetricTile
          label="Present"
          value={present.toString()}
          tone="emerald"
        />
        <MetricTile
          label="Absent"
          value={absent.toString()}
          tone={absent > 0 ? "amber" : "muted"}
        />
        <MetricTile
          label="Days left"
          subLabel="Calendar"
          value={
            daysRemaining === null
              ? "—"
              : daysRemaining < 0
                ? "Ended"
                : daysRemaining.toString()
          }
          tone="muted"
        />
      </div>
    </div>
  );
}

function MetricTile({
  label,
  subLabel,
  value,
  tone,
}: {
  label: string;
  subLabel?: string;
  value: string;
  tone: "emerald" | "amber" | "red" | "muted";
}) {
  const toneText = {
    emerald: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    red: "text-destructive",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-surface/60 px-3 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneText)}>
        {value}
      </div>
      {subLabel && (
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {subLabel}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Section 4 — Fees
// ===========================================================================

function FeesSection({
  studentId,
  isAdminViewer,
}: {
  studentId: string;
  isAdminViewer: boolean;
}) {
  const feesQuery = useStudentFees(studentId, { enabled: isAdminViewer });

  return (
    <SectionCard
      icon={<ReceiptText className="h-5 w-5" />}
      title="Fees"
      subtitle="Outstanding balance + recent payment"
      trailing={
        <Link
          href="/fees/payments"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Payment history →
        </Link>
      }
    >
      {!isAdminViewer ? (
        <RoleRestrictedNote />
      ) : feesQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : feesQuery.isError ? (
        <SectionError
          message={
            feesQuery.error instanceof ApiError
              ? feesQuery.error.message
              : "Failed to load fees."
          }
          onRetry={() => feesQuery.refetch()}
        />
      ) : (
        <FeesStats report={feesQuery.data} />
      )}
    </SectionCard>
  );
}

function FeesStats({ report }: { report: StudentFeesReport | undefined }) {
  if (!report) return null;
  // Last payment = most-recent by date string (ISO sorts
  // lexicographically). Ignore refunds for the "last received"
  // surface since they net out on the assignment-level totals.
  const lastPayment = [...report.payments]
    .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
    .find((p) => p.amount > 0);

  const hasDue = report.totalDue > 0;
  const heroTone = hasDue
    ? "text-destructive"
    : "text-emerald-700 dark:text-emerald-400";
  const heroBg = hasDue
    ? "from-destructive/10 to-destructive/5 ring-destructive/20"
    : "from-emerald-500/10 to-emerald-500/5 ring-emerald-500/20";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
      {/* Outstanding amount as the hero — color carries the urgency
          signal. Zero owed reads as a soft emerald confirmation; a
          balance reads as a destructive warning without shouting. */}
      <div
        className={cn(
          "rounded-xl bg-gradient-to-br p-5 ring-1 ring-inset",
          heroBg,
        )}
      >
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Outstanding dues
        </div>
        <div className={cn("mt-1 text-3xl font-semibold tabular-nums", heroTone)}>
          {formatCurrency(report.totalDue)}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {hasDue
            ? `of ${formatCurrency(report.totalAssigned)} assigned this session`
            : "All assigned fees cleared"}
        </div>
      </div>

      {/* Secondary metrics — total paid + last received. Each in its
          own tile so the operator scans them as discrete facts. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface/60 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Total paid
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {formatCurrency(report.totalPaid)}
          </div>
          {report.totalCredit > 0 && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              + {formatCurrency(report.totalCredit)} unallocated credit
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface/60 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Last payment
          </div>
          {lastPayment ? (
            <>
              <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {formatCurrency(lastPayment.amount)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                <DualDate date={lastPayment.date} />
              </div>
            </>
          ) : (
            <div className="mt-1 text-sm italic text-muted-foreground">
              No payments yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleRestrictedNote() {
  // Renders as an INFO notice (not an error) — teachers / staff land
  // on this page legitimately; they just can't see the financial
  // surface. The tone says "this exists, ask the right person" not
  // "something went wrong."
  return (
    <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm dark:border-sky-500/30 dark:bg-sky-500/10">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
      <div className="space-y-0.5">
        <div className="font-medium text-sky-900 dark:text-sky-200">
          Admin access required
        </div>
        <div className="text-sky-800/80 dark:text-sky-300/80">
          Fee details are restricted to school admins. Ask your school
          admin for the dues breakdown, or open the Fees module if your
          account has elevated access.
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Section 5 — CDC ratings (per subject)
// ===========================================================================

function CdcSection({ student }: { student: StudentDto }) {
  const className = student.class?.name ?? student.section?.class.name ?? null;
  const classLevel = extractClassLevel(className);
  return (
    <SectionCard
      icon={<BookOpen className="h-5 w-5" />}
      title="CDC continuous evaluation"
      subtitle={
        classLevel === null
          ? "Class level couldn't be derived from the assigned class name."
          : `Class ${classLevel} curriculum · 7 subjects`
      }
    >
      {classLevel === null ? (
        <p className="text-sm italic text-muted-foreground">
          Unable to map this student's class to a CDC curriculum level.
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {ALL_SUBJECT_CODES.map((subjectCode) => (
            <CdcSubjectRow
              key={subjectCode}
              student={student}
              subjectCode={subjectCode}
              classLevel={classLevel}
            />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function CdcSubjectRow({
  student,
  subjectCode,
  classLevel,
}: {
  student: StudentDto;
  subjectCode: SubjectCode;
  classLevel: number;
}) {
  const { selected } = useAcademicSession();
  const outcomesQuery = useLearningOutcomesByClassAndSubject(
    classLevel,
    subjectCode,
  );

  const isSeeded =
    (outcomesQuery.data?.length ?? 0) > 0 && !outcomesQuery.isError;

  const recordsQuery = useContinuousRecordsForStudent(
    student.id,
    selected?.id ?? "",
    {
      enabled: Boolean(selected?.id) && isSeeded,
      subjectCode,
    },
  );

  // Visual hierarchy: seeded subjects get full chrome (subject name in
  // foreground, distribution chips + segmented bar). Unseeded subjects
  // dim the name + render the "not yet enabled" inline in a muted
  // tone — present but quiet so they don't compete with the seeded
  // row for attention.
  return (
    <li className={cn("py-3", !isSeeded && "opacity-70")}>
      {outcomesQuery.isLoading ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">
            {SUBJECT_DISPLAY_NAME[subjectCode]}
          </span>
          <Skeleton className="h-5 w-32" />
        </div>
      ) : !isSeeded ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-muted-foreground">
            {SUBJECT_DISPLAY_NAME[subjectCode]}
          </span>
          <span className="inline-flex items-center gap-1 text-xs italic text-muted-foreground/70">
            <Info className="h-3 w-3" />
            Not yet enabled
          </span>
        </div>
      ) : (
        <CdcSeededRow
          subjectCode={subjectCode}
          recordsQuery={recordsQuery}
          outcomeCount={outcomesQuery.data?.length ?? 0}
        />
      )}
    </li>
  );
}

function CdcSeededRow({
  subjectCode,
  recordsQuery,
  outcomeCount,
}: {
  subjectCode: SubjectCode;
  recordsQuery: {
    isLoading: boolean;
    isError: boolean;
    data: ContinuousRecordDto[] | undefined;
  };
  outcomeCount: number;
}) {
  const records = recordsQuery.data ?? [];

  // Dedupe per outcome — AFTER_SUPPORT wins where present.
  const effectiveByOutcome = new Map<string, 1 | 2 | 3 | 4>();
  for (const r of records) {
    const existing = effectiveByOutcome.get(r.outcomeId);
    if (!existing || r.phase === "AFTER_SUPPORT") {
      effectiveByOutcome.set(r.outcomeId, r.rating);
    }
  }
  const buckets = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const rating of effectiveByOutcome.values()) buckets[rating] += 1;
  const ratedOutcomes = effectiveByOutcome.size;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {SUBJECT_DISPLAY_NAME[subjectCode]}
          </span>
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800 ring-1 ring-inset ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
            Enabled
          </span>
        </div>
        {recordsQuery.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : recordsQuery.isError ? (
          <span className="text-xs text-destructive">
            Couldn't load ratings
          </span>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">
              {ratedOutcomes}
            </span>{" "}
            of {outcomeCount} outcomes rated
          </span>
        )}
      </div>

      {/* Segmented progress bar — 4 stacked color blocks proportional
          to the bucket counts. Reads as a single "what's the
          distribution?" glance. Unrated portion shows as muted gray. */}
      <CdcDistributionBar
        buckets={buckets}
        ratedOutcomes={ratedOutcomes}
        outcomeCount={outcomeCount}
        loading={recordsQuery.isLoading}
      />

      {/* Chip row — explicit bucket counts under the bar so the
          operator can read precise numbers, not just proportions. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {([1, 2, 3, 4] as const).map((level) => (
          <span
            key={level}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset",
              ratingChipTone(level),
              buckets[level] === 0 && "opacity-50",
            )}
            title={`${buckets[level]} outcome${buckets[level] === 1 ? "" : "s"} rated ${level}`}
          >
            <span className="text-foreground/60">Lv {level}</span>
            <span>{buckets[level]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function CdcDistributionBar({
  buckets,
  ratedOutcomes,
  outcomeCount,
  loading,
}: {
  buckets: Record<1 | 2 | 3 | 4, number>;
  ratedOutcomes: number;
  outcomeCount: number;
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-2 w-full rounded-full" />;
  }
  if (outcomeCount === 0) {
    return <div className="h-2 w-full rounded-full bg-muted/40" />;
  }
  const unrated = Math.max(0, outcomeCount - ratedOutcomes);
  const widths = {
    1: `${(buckets[1] / outcomeCount) * 100}%`,
    2: `${(buckets[2] / outcomeCount) * 100}%`,
    3: `${(buckets[3] / outcomeCount) * 100}%`,
    4: `${(buckets[4] / outcomeCount) * 100}%`,
    unrated: `${(unrated / outcomeCount) * 100}%`,
  } as const;
  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40"
      role="img"
      aria-label={`${ratedOutcomes} of ${outcomeCount} outcomes rated`}
    >
      <div className="bg-red-500" style={{ width: widths[1] }} />
      <div className="bg-amber-500" style={{ width: widths[2] }} />
      <div className="bg-sky-500" style={{ width: widths[3] }} />
      <div className="bg-emerald-500" style={{ width: widths[4] }} />
      <div className="bg-muted-foreground/15" style={{ width: widths.unrated }} />
    </div>
  );
}

function ratingChipTone(level: 1 | 2 | 3 | 4): string {
  switch (level) {
    case 1:
      return "bg-red-50 text-red-800 ring-red-200/60 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30";
    case 2:
      return "bg-amber-50 text-amber-800 ring-amber-200/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30";
    case 3:
      return "bg-sky-50 text-sky-800 ring-sky-200/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30";
    case 4:
      return "bg-emerald-50 text-emerald-800 ring-emerald-200/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30";
  }
}

// ===========================================================================
// Section 6 — Exam scores
// ===========================================================================

function ExamScoresSection({ studentId }: { studentId: string }) {
  const { selected } = useAcademicSession();
  const examsQuery = useExams(selected?.id ?? null);
  const examIds = React.useMemo(
    () => (examsQuery.data ?? []).map((e) => e.id),
    [examsQuery.data],
  );
  const results = useStudentExamResults(examIds, studentId, {
    enabled: examIds.length > 0,
  });

  return (
    <SectionCard
      icon={<ClipboardList className="h-5 w-5" />}
      title="Exam scores"
      subtitle={selected ? selected.name : undefined}
    >
      {examsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded" />
          ))}
        </div>
      ) : examsQuery.isError ? (
        <SectionError
          message={
            examsQuery.error instanceof ApiError
              ? examsQuery.error.message
              : "Failed to load exams."
          }
          onRetry={() => examsQuery.refetch()}
        />
      ) : (examsQuery.data ?? []).length === 0 ? (
        <NoExamsState />
      ) : (
        <ExamScoresTable
          exams={examsQuery.data ?? []}
          results={results}
        />
      )}
    </SectionCard>
  );
}

function NoExamsState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 px-6 py-10 text-center">
      <div className="relative mb-4 h-14 w-14">
        <div className="absolute inset-0 rotate-[6deg] rounded-2xl bg-gradient-to-br from-primary-100/70 to-primary-50/30" />
        <div className="absolute inset-0 -rotate-[4deg] rounded-2xl bg-gradient-to-br from-sky-100/70 to-sky-50/30" />
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-border bg-surface/85 text-primary shadow-sm">
          <ClipboardList className="h-6 w-6" strokeWidth={1.5} />
        </div>
      </div>
      <p className="text-sm font-medium text-foreground">No exams this session</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground leading-relaxed">
        Once exams are created and marks entered, this student's scores
        will appear here.
      </p>
    </div>
  );
}

function ExamScoresTable({
  exams,
  results,
}: {
  exams: ExamDto[];
  results: {
    byExamId: Map<string, StudentReport | null>;
    isLoading: boolean;
  };
}) {
  return (
    <div className="space-y-2">
      {exams.map((exam) => {
        const report = results.byExamId.get(exam.id);
        const loading = results.isLoading && report === undefined;
        const gpaValue =
          report && report.gpa >= 0 ? report.gpa.toFixed(2) : null;
        return (
          <details
            key={exam.id}
            className="group overflow-hidden rounded-lg border border-border bg-surface/50 transition-colors hover:border-primary/30 open:border-primary/30 open:bg-muted/30"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">
                    {exam.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {exam.subjects.length}{" "}
                    {exam.subjects.length === 1 ? "subject" : "subjects"}
                  </div>
                </div>
              </div>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : report === null ? (
                <span className="shrink-0 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] italic text-muted-foreground">
                  No marks
                </span>
              ) : gpaValue !== null ? (
                <span className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20 tabular-nums">
                  <span className="text-[10px] uppercase tracking-wider text-primary/70">
                    GPA
                  </span>
                  {gpaValue}
                </span>
              ) : report ? (
                <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive ring-1 ring-inset ring-destructive/20">
                  NG
                </span>
              ) : null}
            </summary>
            <div className="border-t border-border/60 bg-muted/10 px-4 py-3">
              {loading ? (
                <Skeleton className="h-6 w-full" />
              ) : report === null ? (
                <p className="text-xs italic text-muted-foreground">
                  No marks recorded for this exam.
                </p>
              ) : report ? (
                <ExamSubjectsList report={report} />
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ExamSubjectsList({ report }: { report: StudentReport }) {
  if (report.results.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        No subject rows recorded.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/40 text-sm">
      {report.results.map((row) => (
        <li
          key={row.id}
          className="flex items-center justify-between gap-3 py-1.5"
        >
          <span className="text-foreground">{row.subjectName}</span>
          <span className="tabular-nums text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">
                {row.marks}
              </span>
              <span className="text-muted-foreground">
                {" "}
                / {row.fullMarks}
              </span>
              {row.letterGradeLabel && (
                <span className="ml-2 text-xs font-semibold text-foreground">
                  {row.letterGradeLabel}
                </span>
              )}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ===========================================================================
// Shared section card + helpers
// ===========================================================================

function SectionCard({
  icon,
  title,
  subtitle,
  trailing,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  /** Optional right-aligned slot (e.g., a "view full history" link). */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-xl p-5 sm:p-6 animate-fade-in-up">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-md font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * IconField — a labelled value with an icon glyph next to the label.
 * Used inside Identity + Academic dl-grids. Replaces the older
 * label-only Field — icons add scannable context (calendar = date,
 * phone = contact, etc.).
 *
 * When `value` is null / undefined / empty, renders the `fallback`
 * text in a dim italic tone so a missing field reads as "we don't
 * have this" rather than a confusing empty space or a bare em-dash.
 */
function IconField({
  icon,
  label,
  value,
  fallback = "Not provided",
  full,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  fallback?: string;
  full?: boolean;
}) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0);
  return (
    <div className={cn(full && "sm:col-span-2")}>
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">
        {isEmpty ? (
          <span className="italic text-muted-foreground/70">{fallback}</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/**
 * SubsectionLabel — tiny uppercase divider for grouping fields inside
 * a single card (e.g., "Personal" vs "Contact" inside Identity).
 * Quieter than a full section header; sits at the top of a group of
 * dl rows.
 */
function SubsectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
      {children}
    </div>
  );
}

function SectionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <div className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRetry}
        leftIcon={<RotateCw className="h-3.5 w-3.5" />}
      >
        Retry
      </Button>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}

function NotFoundPanel() {
  return (
    <div className="space-y-4">
      <Link
        href="/students"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Students
      </Link>
      <div className="glass rounded-xl p-8">
        <EmptyState
          icon={<UserIcon className="h-10 w-10" strokeWidth={1.5} />}
          title="Student not found"
          description="This student no longer exists, or you don't have access to view them."
          action={{
            label: "Back to Students",
            onClick: () => {
              window.location.href = "/students";
            },
          }}
        />
      </div>
    </div>
  );
}

function RetryPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <Link
        href="/students"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Students
      </Link>
      <div className="glass rounded-xl p-8">
        <div className="mx-auto max-w-sm text-center space-y-3">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Couldn't load this student
          </h2>
          <p className="text-sm text-muted-foreground">{message}</p>
          <Button
            onClick={onRetry}
            leftIcon={<RotateCw className="h-4 w-4" />}
          >
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Pure helpers
// ===========================================================================

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function computeAge(dateOfBirth: string): number | null {
  // Accepts YYYY-MM-DD; returns the integer-year age relative to today.
  // Null if the date doesn't parse.
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    years -= 1;
  }
  return years < 0 ? null : years;
}

function computeDaysRemaining(endDate: string): number | null {
  const end = new Date(`${endDate}T23:59:59Z`);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  const diffMs = end.getTime() - today.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}
