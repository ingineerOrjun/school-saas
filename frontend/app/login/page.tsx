"use client";

import * as React from "react";
import {
  ArrowRight,
  CalendarCheck,
  GraduationCap,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  login,
  registerAdmin,
  type AuthResult,
} from "@/lib/auth";

/**
 * Role-based landing page after a successful login.
 *   • ADMIN  → /dashboard (school-wide overview).
 *   • TEACHER with at least one TeachingAssignment → /attendance,
 *     deep-linked to the primary class/section so they land directly
 *     on a roster.
 *   • TEACHER without any assignment → /dashboard. The teacher
 *     dashboard view detects the empty state and renders the
 *     "ask admin to assign you" hero on its own.
 *   • Future roles fall back to the dashboard so we never strand a
 *     newly-introduced role on a 404.
 *
 * `hasAssignments` is the source of truth — sourced from the
 * TeachingAssignment table on the backend. The legacy
 * `Teacher.classId` is no longer consulted (it doesn't update when
 * admins use the multi-row Assignments dialog).
 */
function landingFor(result: AuthResult): string {
  if (result.user.role === "TEACHER") {
    if (!result.teacher?.hasAssignments) {
      return "/dashboard";
    }
    if (result.teacher.sectionId) {
      return `/attendance?sectionId=${result.teacher.sectionId}`;
    }
    if (result.teacher.classId) {
      return `/attendance?classId=${result.teacher.classId}`;
    }
    return "/attendance";
  }
  return "/dashboard";
}

type Mode = "signin" | "signup";

/**
 * Login page — clean, professional school-system look.
 *
 * Layout:
 *   • Two-column on >= md (brand left, form card right)
 *   • Single column on mobile (brand stacks above the card)
 *
 * Visuals follow the user-spec:
 *   • Light neutral background (slate-50)
 *   • Form sits in a calm bordered card (border-slate-200, no heavy shadow)
 *   • Single primary color (indigo-600) on buttons, focus rings, and links
 *   • Shared `Input` + `Button` components — same primitives the rest
 *     of the app uses, so the brand identity is consistent
 *
 * Auth logic and role-based routing are unchanged from the prior
 * design — only the chrome was replaced.
 */
export default function LoginPage() {
  // Note: no `useRouter` here. Successful login uses
  // `window.location.assign` (hard navigation) so SPA state from any
  // prior session is fully wiped before the dashboard mounts.
  const [mode, setMode] = React.useState<Mode>("signin");
  const [loading, setLoading] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [schoolName, setSchoolName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const isSignIn = mode === "signin";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let result: AuthResult;
      if (mode === "signin") {
        result = await login(email, password);
        toast.success(`Welcome back to ${result.school.name}`);
      } else {
        result = await registerAdmin(email, password, schoolName);
        toast.success(`Workspace ready — welcome to ${result.school.name}`);
      }
      // Hard navigation, NOT router.push. Two reasons:
      //   1. SPA state from any prior session (in-flight queries,
      //      cached components, contexts) gets fully reset — no risk
      //      of stale "I was logged in as X" data leaking into the
      //      new identity.
      //   2. The dashboard layout's localStorage gate re-runs from a
      //      fresh module load, so the role/identity pickup is
      //      deterministic instead of racing whatever React state
      //      happened to be around.
      window.location.assign(landingFor(result));
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[1100px] grid gap-10 md:gap-16 md:grid-cols-2 md:items-center">
        {/* ---------- Left: branding ---------- */}
        <BrandPanel />

        {/* ---------- Right: form card ---------- */}
        <div className="w-full max-w-md mx-auto md:mx-0 md:ml-auto">
          <div className="bg-surface border border-border rounded-lg p-6 sm:p-8">
            <div className="space-y-1.5 mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {isSignIn ? "Sign in to your school" : "Create your workspace"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isSignIn
                  ? "Manage your school with ease."
                  : "Set up a new school in under a minute."}
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              {!isSignIn && (
                <Input
                  label="School name"
                  placeholder="e.g. Oakridge International"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                />
              )}
              <Input
                label="Email"
                type="email"
                placeholder="you@school.edu"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus={isSignIn}
                disabled={loading}
              />
              <Input
                label="Password"
                type="password"
                placeholder={
                  isSignIn ? "Your password" : "At least 8 characters"
                }
                autoComplete={
                  isSignIn ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={loading}
                hint={
                  !isSignIn
                    ? "Use at least 8 characters with one uppercase letter and one number."
                    : undefined
                }
              />

              {/* Inline error — sits above the submit button so the user
                  doesn't have to hunt for it. The toast covers the
                  out-of-corner case. */}
              {error && (
                <p
                  className="text-sm text-destructive leading-snug"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={loading}
                rightIcon={
                  !loading ? <ArrowRight className="h-4 w-4" /> : undefined
                }
              >
                {isSignIn ? "Sign In" : "Create workspace"}
              </Button>
            </form>

            {/* Mode toggle — calm text link, no second CTA button.
                Keeps the card focused on the primary action. */}
            <div className="mt-6 pt-6 border-t border-border text-center">
              {isSignIn ? (
                <p className="text-sm text-muted-foreground">
                  New to Scholaris?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                    }}
                    disabled={loading}
                    className="font-medium text-primary hover:text-primary/80 hover:underline disabled:opacity-60 transition-colors focus:outline-none focus:underline"
                  >
                    Create a workspace
                  </button>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Already have a workspace?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signin");
                      setError(null);
                    }}
                    disabled={loading}
                    className="font-medium text-primary hover:text-primary/80 hover:underline disabled:opacity-60 transition-colors focus:outline-none focus:underline"
                  >
                    Sign in instead
                  </button>
                </p>
              )}
            </div>
          </div>

          {/* Footer line under the card — small, calm, never competes
              with the form. */}
          <p className="mt-4 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} Scholaris. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand panel — left column on desktop, top of stack on mobile.
//
// Intentionally calm: just the wordmark, the tagline, and three feature
// bullets. No illustration, no testimonial, no marketing chrome —
// matches the spec's "professional school system" tone.
// ---------------------------------------------------------------------------

function BrandPanel() {
  return (
    <div className="text-center md:text-left">
      <div className="inline-flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <span className="text-2xl font-semibold tracking-tight text-foreground">
          Scholaris
        </span>
      </div>

      <h2 className="mt-6 text-3xl md:text-4xl font-semibold tracking-tight text-foreground leading-[1.15]">
        Smart School Management System
      </h2>
      <p className="mt-3 text-base text-muted-foreground max-w-md mx-auto md:mx-0">
        Everything your school needs in one calm workspace —
        students, attendance, exams, and fees.
      </p>

      {/* Three subtle feature bullets. Visible only on >= md so the
          mobile layout stays compact. */}
      <ul className="mt-8 hidden md:flex flex-col gap-3 text-sm text-foreground/85">
        <FeatureItem icon={<GraduationCap className="h-4 w-4" />}>
          Manage students, teachers, and classes in one place.
        </FeatureItem>
        <FeatureItem icon={<CalendarCheck className="h-4 w-4" />}>
          Track attendance and enter marks in seconds.
        </FeatureItem>
        <FeatureItem icon={<ShieldCheck className="h-4 w-4" />}>
          Role-based access keeps every account scoped to its work.
        </FeatureItem>
      </ul>
    </div>
  );
}

function FeatureItem({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
