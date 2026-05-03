"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/Skeleton";
import { AdminDashboardView } from "@/components/dashboard/AdminDashboardView";
import { TeacherDashboardView } from "@/components/dashboard/TeacherDashboardView";
import { getStoredUser, getToken, type Role } from "@/lib/auth";

/**
 * Role-aware dashboard router.
 *
 *   • ADMIN   → AdminDashboardView (school-wide stats, fees, onboarding,
 *               recent enrollments, "Add student" CTA, etc.)
 *   • TEACHER → TeacherDashboardView (their assigned class, today's
 *               attendance + CTA, pending tasks, capped roster, 30-day %).
 *               Hides every admin-only surface (fees, total students,
 *               total teachers, school credit, "Add student").
 *
 * Both views are client-rendered, so the role is resolved from the
 * cached user in localStorage. We hold a lightweight skeleton for the
 * one render before useEffect runs — this avoids a flash of "wrong"
 * dashboard for the opposite role.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [role, setRole] = React.useState<Role | null>(null);
  const [resolved, setResolved] = React.useState(false);

  React.useEffect(() => {
    // Auth guard — same as before.
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setRole(getStoredUser()?.role ?? null);
    setResolved(true);
  }, [router]);

  if (!resolved) {
    return <RoleResolutionSkeleton />;
  }

  // TEACHER gets the focused view. Every other role (ADMIN, plus the
  // future STUDENT/PARENT roles until they get their own dashboards)
  // falls back to the admin view, which read-only-degrades gracefully
  // — better than a 404 for a newly-introduced role.
  if (role === "TEACHER") {
    return <TeacherDashboardView />;
  }
  return <AdminDashboardView />;
}

/**
 * One-frame placeholder shown while the role is resolved from
 * localStorage. Mirrors the height/shape of either dashboard hero so
 * there's no visible jump when the real view mounts.
 */
function RoleResolutionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-8">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-10 w-80" />
        <Skeleton className="mt-3 h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="glass rounded-xl p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
