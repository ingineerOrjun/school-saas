"use client";

import {
  QueryClient,
  type InvalidateQueryFilters,
  type QueryKey,
} from "@tanstack/react-query";
import { isNetworkError } from "./api";

// ---------------------------------------------------------------------------
// Global query client + tiered staleTime defaults.
//
// One QueryClient per browser session. Mounted at the root layout
// so EVERY page (school dashboard + platform layer + login) gets
// the same cache + the same defaults.
//
// staleTime tiers (use these as constants when calling useQuery):
//   • REFERENCE_DATA — 10m. Classes, sections, subjects, school
//     settings, academic sessions, feature catalog. Changes are
//     operator-actions, not user-driven; refetching every minute
//     is wasteful.
//   • SEMI_STATIC    — 1m. Dashboards, analytics summaries, school
//     snapshots. Updates are batched (cron / occasional writes);
//     1m is enough freshness without thrashing.
//   • LIVE_OPERATOR  — 30s. Notifications inbox, audit log feed,
//     subscription state. User expects "near-live" but not realtime.
//   • LIVE_HEALTH    — 15s. Operator pulse: /platform/health,
//     queue depth. Operator is actively watching during incident
//     response.
//   • ALWAYS_FRESH   — 0. Mutation-paired reads where stale data
//     is wrong (e.g. read-after-write confirmation).
//
// Why no global polling default:
//   Polling is a per-query opt-in. Each query that genuinely needs
//   live updates (notifications unread count, platform health) sets
//   its own refetchInterval. Defaulting to polling app-wide is the
//   anti-pattern that produced the 429 storm in the first place.
// ---------------------------------------------------------------------------

export const STALE = {
  REFERENCE_DATA: 10 * 60_000, // 10m
  SEMI_STATIC: 60_000, // 1m
  LIVE_OPERATOR: 30_000, // 30s
  LIVE_HEALTH: 15_000, // 15s
  ALWAYS_FRESH: 0,
} as const;

/**
 * The active client. Created lazily on first access. Singleton —
 * tests + the QueryProvider use this exact instance.
 *
 * Don't import this directly from components — go through the
 * `QueryClientProvider` ancestor and `useQueryClient()` instead.
 * Keeping a module-level singleton too lets non-React code
 * (interceptors, sync engines) invalidate caches.
 */
let client: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (!client) client = createQueryClient();
  return client;
}

/**
 * Phase Ω governance — dev-only `invalidateQueries` warning.
 *
 * `invalidateQueries({})` (no key) refetches EVERY query in the cache.
 * That's almost always a bug — accidental in 99% of cases. We log a
 * loud warning in dev so the offending mutation can be tightened to
 * a specific key. Production passes through unchanged.
 *
 * The wrapper preserves the full QueryClient surface; only the
 * `invalidateQueries` method is intercepted.
 */
function withGovernance(qc: QueryClient): QueryClient {
  if (process.env.NODE_ENV === "production") return qc;
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((
    filters?: InvalidateQueryFilters,
    options?: Parameters<typeof original>[1],
  ) => {
    const key = filters?.queryKey as QueryKey | undefined;
    if (!key || (Array.isArray(key) && key.length === 0)) {
      // eslint-disable-next-line no-console
      console.warn(
        "[query-governance] invalidateQueries called with no queryKey — this refetches the ENTIRE cache. " +
          "Pass an explicit queryKey: invalidateQueries({ queryKey: qk.something(...) })",
        new Error("traceback"),
      );
    }
    return original(filters, options);
  }) as QueryClient["invalidateQueries"];
  return qc;
}

export function createQueryClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        // Sensible default for an authenticated dashboard. Per-query
        // overrides via STALE.* constants are encouraged.
        staleTime: STALE.SEMI_STATIC,
        // 30m garbage collection — keep cache around long enough
        // for back/forward navigation to feel instant, but don't
        // hold dead caches forever.
        gcTime: 30 * 60_000,
        // One retry on transient failure. The api-layer 429 path
        // (lib/api.ts) handles rate-limit by throwing immediately
        // with status 429; this catches 5xx blips. NETWORK errors
        // (ERR_CONNECTION_REFUSED, DNS, offline) are NEVER retried
        // here — `lib/api.ts` rethrows them as ApiError(status=0)
        // and `isNetworkError()` short-circuits this guard to
        // prevent retry storms into a dead backend. The browser's
        // own `online` event + `refetchOnReconnect: true` below
        // gives queries a chance to recover when connectivity
        // returns; the retry guard is the in-request defense.
        retry: (failureCount, error) => {
          if (isNetworkError(error)) return false;
          const status = (error as { status?: number } | null)?.status;
          if (status === 401 || status === 403 || status === 429) {
            return false;
          }
          return failureCount < 1;
        },
        // ERP dashboards are long-lived tabs. Auto-refocus refetch
        // is noise + the cause of a previous 429 wave.
        refetchOnWindowFocus: false,
        // Recover from transient network drops automatically.
        refetchOnReconnect: true,
        // If we already have data in cache, don't refetch on mount —
        // serve cached + the staleTime check decides if we should
        // background-refresh.
        refetchOnMount: false,
        // Online-only — offline mode is handled by the offline-queue
        // engine for writes, not by React Query.
        networkMode: "online",
      },
      mutations: {
        // Don't auto-retry mutations — duplicate writes are worse
        // than a single failure the user can see + retry.
        retry: 0,
      },
    },
  });
  return withGovernance(qc);
}
