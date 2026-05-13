"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { getStoredUser } from "./auth";
import { useAuthReady } from "@/hooks/useAuthReady";
import { qk } from "./query-keys";
import { STALE } from "./query-client";

// ---------------------------------------------------------------------------
// Phase 5 — frontend feature flag client.
//
// Mirrors backend/src/feature-flags/feature-catalog.ts. Both files
// must stay in sync — keep keys + defaults identical. The backend
// is the source of truth at request time (the guard rejects calls
// to disabled features); this catalog drives sidebar visibility and
// page-level access gates.
//
// Resolution model:
//   • On login / page-load, the dashboard layout calls /me/features.
//   • The result is cached in localStorage under FEATURES_KEY plus
//     in-memory via the React context, so navigation reads are
//     synchronous.
//   • On logout / impersonation start/end, the cache is cleared so
//     the next layout mount fetches fresh.
//
// Failure mode:
//   • If /me/features 500s (rare — same DB as the rest of auth),
//     we fall back to "all known features ON" so the user isn't
//     stranded with a half-broken UI. This matches the catalog's
//     defaults for the existing modules; future features default
//     OFF in the catalog so the failure mode is conservative for
//     premium-only modules.
// ---------------------------------------------------------------------------

export const FeatureKey = {
  Analytics: "analytics",
  Announcements: "announcements",
  Promotion: "promotion",
  Sms: "sms",
  Transport: "transport",
  Hostel: "hostel",
} as const;

export type FeatureKeyValue = (typeof FeatureKey)[keyof typeof FeatureKey];

export interface FeatureCatalogEntry {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  comingSoon: boolean;
}

export interface MyFeaturesResponse {
  features: Record<string, boolean>;
  catalog: FeatureCatalogEntry[];
  /**
   * Phase 17 — tenant-state flags. Drives banners (maintenance mode)
   * + gates that aren't keyed off plan features. Optional in the
   * type so older backends without the field still parse.
   */
  tenant?: {
    maintenanceMode: boolean;
  };
}

const FEATURES_KEY = "scholaris:features";

/**
 * Catalog defaults — used as the fallback when the API call hasn't
 * returned yet (initial paint) and when the server errors out.
 * Keep in sync with the backend catalog: existing-module flags are
 * `true`, future-module flags are `false`.
 */
export const FEATURE_DEFAULTS: Record<string, boolean> = {
  [FeatureKey.Analytics]: true,
  [FeatureKey.Announcements]: true,
  [FeatureKey.Promotion]: true,
  [FeatureKey.Sms]: false,
  [FeatureKey.Transport]: false,
  [FeatureKey.Hostel]: false,
};

export const featuresApi = {
  getMine: () => api<MyFeaturesResponse>("/me/features"),
};

/**
 * Synchronous read from localStorage cache. Returns the catalog
 * defaults when nothing is cached yet — components can call this
 * during render without spinning up an effect, and the cache will
 * have been populated by the layout-level fetch.
 */
export function getCachedFeatures(): Record<string, boolean> {
  if (typeof window === "undefined") return { ...FEATURE_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(FEATURES_KEY);
    if (!raw) return { ...FEATURE_DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...FEATURE_DEFAULTS, ...parsed };
  } catch {
    return { ...FEATURE_DEFAULTS };
  }
}

export function cacheFeatures(features: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FEATURES_KEY, JSON.stringify(features));
  } catch {
    /* storage unavailable */
  }
}

export function clearCachedFeatures(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FEATURES_KEY);
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// React hook + context — single source of truth at runtime.
// ---------------------------------------------------------------------------

interface FeaturesContextValue {
  features: Record<string, boolean>;
  catalog: FeatureCatalogEntry[];
  /** Cheap "is this on?" — same precedence as the cached map. */
  isEnabled: (key: string) => boolean;
  /** Re-fetch from the API. The dashboard layout calls this on mount. */
  refresh: () => Promise<void>;
  /** True while the first fetch is in flight. */
  loading: boolean;
  /** Phase 17 — true when the tenant is in maintenance mode. */
  maintenanceMode: boolean;
}

const FeaturesContext = React.createContext<FeaturesContextValue | null>(null);

/**
 * Provider for the feature flag context. Mounted ONCE in the
 * dashboard / platform layouts. Wraps the React Query result for
 * `/me/features` so every `useFeatures()` call goes through the
 * shared cache — no parallel fetches across pages, modals, or
 * sidebar mounts.
 *
 * Reference data (REFERENCE_DATA staleTime, 10m) — features
 * change on operator-grade actions (subscription create / override
 * write), not on user-driven flow. The shared cache covers a full
 * SPA navigation cycle without refetching.
 */
export function FeaturesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Phase α follow-up — gate on the subscribable auth-store. Was:
  // synchronous getToken() read which raced the bootstrap window
  // and produced user=<anon> 429s on /me/features.
  const { authReady, isAuthenticated } = useAuthReady();
  const query = useQuery({
    queryKey: qk.meFeatures,
    queryFn: () => featuresApi.getMine(),
    enabled: authReady && isAuthenticated,
    // Phase γ — feature flags change rarely (operator action).
    // 30m stale + 30m gc keeps the provider quiet across navigation.
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403) return false;
      return failureCount < 1;
    },
  });

  // Side-effect: warm the localStorage cache on every successful
  // fetch so getCachedFeatures() (used by getCachedFeatures-only
  // callers like FeatureGate during initial paint) stays current.
  React.useEffect(() => {
    if (query.data) cacheFeatures(query.data.features);
  }, [query.data]);

  // Conservative fallback when the query hasn't resolved yet:
  // serve from localStorage so the UI doesn't flash empty + the
  // sidebar doesn't show every nav entry while we wait.
  const cachedSeed = React.useMemo(() => getCachedFeatures(), []);
  const features = query.data?.features ?? cachedSeed;
  const catalog = query.data?.catalog ?? [];
  const maintenanceMode = query.data?.tenant?.maintenanceMode ?? false;
  const loading = query.isLoading;

  const isEnabled = React.useCallback(
    (key: string) => features[key] ?? FEATURE_DEFAULTS[key] ?? false,
    [features],
  );

  // `refresh` is exposed for code paths that want to force-update
  // (e.g. after a SUPER_ADMIN flips a flag). React Query's
  // refetch() is the underlying call.
  const refresh = React.useCallback(async () => {
    await query.refetch();
  }, [query]);

  const value = React.useMemo<FeaturesContextValue>(
    () => ({
      features,
      catalog,
      isEnabled,
      refresh,
      loading,
      maintenanceMode,
    }),
    [features, catalog, isEnabled, refresh, loading, maintenanceMode],
  );

  return (
    <FeaturesContext.Provider value={value}>
      {children}
    </FeaturesContext.Provider>
  );
}

/**
 * Read the current feature set. Falls back to a defaults-shaped
 * value when called outside `FeaturesProvider` so non-dashboard
 * pages (e.g. /login) don't crash.
 */
export function useFeatures(): FeaturesContextValue {
  const ctx = React.useContext(FeaturesContext);
  if (ctx) return ctx;
  // Standalone fallback — happens on /login, /platform/access-gate,
  // etc. We don't fetch here; the cached value is what we have.
  const cached = getCachedFeatures();
  return {
    features: cached,
    catalog: [],
    isEnabled: (key: string) => cached[key] ?? FEATURE_DEFAULTS[key] ?? false,
    refresh: async () => {},
    loading: false,
    maintenanceMode: false,
  };
}

/**
 * Single-feature shorthand. Mostly used in render branches where a
 * page hides itself when its feature is off.
 *
 *   const showAnalytics = useFeatureEnabled(FeatureKey.Analytics);
 */
export function useFeatureEnabled(key: string): boolean {
  return useFeatures().isEnabled(key);
}

/**
 * SUPER_ADMINs aren't tenant-bound and the backend reports every
 * feature as enabled for them. This helper short-circuits a few
 * client-side decisions that need the same answer (e.g. the
 * platform UI shouldn't hide its own nav if the operator's
 * impersonating a school with a feature off).
 */
export function isSuperAdmin(): boolean {
  return getStoredUser()?.role === "SUPER_ADMIN";
}
