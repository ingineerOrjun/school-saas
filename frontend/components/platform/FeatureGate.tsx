"use client";

import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { useFeatures, FEATURE_DEFAULTS } from "@/lib/features";
import { getStoredUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// FeatureGate — page-level feature flag check.
//
// Wraps a page's content in a feature check. When the feature is
// off, renders a friendly "feature disabled" panel instead of the
// children. SUPER_ADMIN bypasses (matches the backend guard).
//
// Why a page-level gate when the sidebar already hides the link:
//   • Direct URL navigation. A user (or another tab) might land on
//     /announcements via a stale link.
//   • The backend is the security boundary; this is just better UX
//     than letting the API call 403 and showing a generic error.
//
// Usage:
//
//   export default function AnnouncementsPage() {
//     return (
//       <FeatureGate featureKey="announcements" featureLabel="Announcements">
//         <AnnouncementsView />
//       </FeatureGate>
//     );
//   }
// ---------------------------------------------------------------------------

interface FeatureGateProps {
  /** The feature catalog key (matches backend FEATURE_KEYS). */
  featureKey: string;
  /** Human-readable label shown in the disabled panel. */
  featureLabel: string;
  /** Optional one-line description override; falls back to a generic message. */
  message?: string;
  children: React.ReactNode;
}

export function FeatureGate({
  featureKey,
  featureLabel,
  message,
  children,
}: FeatureGateProps) {
  const { isEnabled, loading } = useFeatures();
  const [role, setRole] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRole(getStoredUser()?.role ?? null);
  }, []);

  // While the first /me/features fetch is in flight, render nothing
  // to avoid a flash of "feature disabled" for a feature that's
  // actually on. The cached value (if any) seeds the initial state
  // so this is usually instant.
  if (loading) {
    return null;
  }

  // SUPER_ADMIN always passes — matches the backend guard.
  if (role === "SUPER_ADMIN") {
    return <>{children}</>;
  }

  // Failsafe: if the catalog isn't even shipping a default for this
  // key (programming error), let the page render. The backend will
  // be the actual gate.
  if (!(featureKey in FEATURE_DEFAULTS)) {
    return <>{children}</>;
  }

  if (isEnabled(featureKey)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold">
          {featureLabel} is not enabled
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {message ??
            `The ${featureLabel} feature isn't part of your school's current plan. Contact your administrator if you'd like access.`}
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
