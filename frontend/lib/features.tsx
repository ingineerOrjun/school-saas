"use client";

import * as React from "react";
import { api } from "./api";
import { getStoredUser, getToken } from "./auth";

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
}

const FeaturesContext = React.createContext<FeaturesContextValue | null>(null);

/**
 * Provider for the feature flag context. Mounted ONCE in the
 * dashboard / platform layouts (whichever the user lands on). Every
 * `useFeatures()` call reads from this context, falling back to
 * defaults when not mounted.
 */
export function FeaturesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [features, setFeatures] = React.useState<Record<string, boolean>>(() =>
    getCachedFeatures(),
  );
  const [catalog, setCatalog] = React.useState<FeatureCatalogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    try {
      const result = await featuresApi.getMine();
      setFeatures(result.features);
      setCatalog(result.catalog);
      cacheFeatures(result.features);
    } catch (e) {
      // Conservative fallback — keep whatever is cached, otherwise
      // the catalog defaults. Don't toast (the UI hasn't asked yet
      // and a generic toast on layout mount is jarring).
      // eslint-disable-next-line no-console
      console.warn("[features] /me/features failed, using cached/defaults:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const isEnabled = React.useCallback(
    (key: string) => features[key] ?? FEATURE_DEFAULTS[key] ?? false,
    [features],
  );

  const value = React.useMemo<FeaturesContextValue>(
    () => ({ features, catalog, isEnabled, refresh, loading }),
    [features, catalog, isEnabled, refresh, loading],
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
