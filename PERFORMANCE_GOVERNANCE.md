# Performance Governance

This is now a production-scale application. Performance regressions
are treated as bugs. These rules are non-negotiable for new code.

## 1. Polling — every interval must justify itself

| Surface | refetchInterval | staleTime | Notes |
|---|---|---|---|
| Notifications unread count | **60s** | 30s | Bell badge. Per-user 120/min bucket — comfortable headroom. |
| Operations cockpit (overview / health / events) | **30s** | LIVE_HEALTH | Bumped from 15s to halve request volume. |
| Operations cockpit (jobs / sessions / security) | **30s** | 20s | Same family — same cadence. |
| Operations cockpit (schools health grid) | **60s** | 60s | Heavier scan; longer cadence. |
| Operations cockpit (incidents) | **30s** | 20s | Critical surface, but not per-second. |
| Platform health page | **30s** | LIVE_HEALTH | Operator monitoring — fine at 30s. |
| Platform deployment / upgrade safety | **60s** | 30s | Read once per minute is plenty. |
| Dashboard summary | **NO POLLING** | 60s | Refresh button is the explicit path. |
| Classes / sessions / features | **NO POLLING** | 10m | Reference data — operator-driven changes only. |
| Students | **NO POLLING** | 60s | Moves with enrollment, not per-second. |
| Analytics | **NO POLLING EVER** | 5m | Heavy scan. User refreshes manually. |

**Defaults:**
- `refetchOnWindowFocus: false` — set in the global `QueryClient` config.
- `refetchIntervalInBackground: false` — every polled query MUST set this.
- `refetchOnMount: false` for reference data (classes / sessions / features / students).

## 2. Auth gating

Every protected query MUST gate on `useAuthReady()`:

```ts
const { authReady, isAuthenticated } = useAuthReady();
const query = useQuery({
  queryKey: qk.…,
  queryFn: () => …,
  enabled: authReady && isAuthenticated,
  retry: (failureCount, error) => {
    const status = (error as { status?: number } | null)?.status;
    if (status === 401 || status === 403) return false;
    return failureCount < 1;
  },
});
```

Fires WITHOUT this gate produce `user=<anon>` 429 storms during the
bootstrap window before the auth-store has hydrated.

## 3. Invalidation — be surgical

The **bad** pattern:

```ts
useMutation({
  mutationFn: (id) => api(...),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['everything'] }); // ❌ refetches 10+ queries
  },
});
```

The **good** pattern (optimistic + targeted):

```ts
useMutation({
  mutationFn: (id) => api(...),
  onMutate: async (input) => {
    // Optimistic — flip local cache, snapshot for rollback
    await qc.cancelQueries({ queryKey: qk.notifications.unreadCount });
    const prev = qc.getQueryData(qk.notifications.unreadCount);
    qc.setQueryData(qk.notifications.unreadCount, (old) => ({
      ...old,
      count: Math.max(0, (old?.count ?? 0) - 1),
    }));
    return { prev };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.prev) qc.setQueryData(qk.notifications.unreadCount, ctx.prev);
  },
  // Intentionally NO onSuccess invalidate — the optimistic state is
  // the truth until the next scheduled poll.
});
```

Reference implementation: `lib/notifications.tsx` `useMarkRead`.

## 4. Toasts — governance

The api() client governs throttle toasts:
- **Per-endpoint cooldown**: 60s (same endpoint won't toast twice in a minute)
- **Global cap**: 30s (any throttle toast suppresses others briefly)
- **Background retries silent**: only EXHAUSTED retries (>3 attempts) surface a toast

Any code that surfaces toasts on its own should follow the same
pattern — dedupe per logical event, never one toast per micro-event.

## 5. Render hygiene

Before adding `useMemo` / `useCallback` / `React.memo`:

1. Profile first (React DevTools profiler) — confirm there's a measurable hot render.
2. Use the **smallest** memoization that fixes the problem.
3. If a context provider is the source, consider splitting it (separate "rarely-changing" config from "frequently-changing" data).

DO NOT memoize speculatively. The wrap cost can exceed the render cost.

## 6. Dev observability

Every dev environment runs the **RequestPressurePanel** (bottom-left
corner, click to expand). Use it to spot:
- Endpoints firing 5+ times in 5s → cache miss or unstable query key.
- Polled endpoints with avg gap < their configured interval → bug.
- Total request count climbing while idle → background poll storm.

If the panel's chip turns amber, fix it before merging.

## 7. Schema diagnostics

The `SchemaCheckService` runs at boot + every 60s in dev. It warns
loudly when migrations are pending or critical columns are missing.
Never ignore that warning — running with schema drift produces
500 storms on the first authenticated request.

`npx prisma migrate deploy` after every schema change. Verify with
`npx prisma migrate status`.

## 8. Performance budgets

| Metric | Target |
|---|---|
| Cold dashboard load (logged in) | ≤ 15 requests, ≤ 2s to interactive |
| Same-page back/forward | mostly cache hits; ≤ 3 requests |
| Mobile attendance roster mount | ≤ 1s on mid-range Android |
| Mobile fee collection picker tap → amount screen | ≤ 200ms |
| `/sync` page poll | once per 3s (IndexedDB read) |

If your change blows past one of these, the change isn't done.

## 9. From now on

- **Every new polling query must justify itself** — drop a comment in
  the hook explaining why it polls and at what interval.
- **Every invalidation must be scoped** — never `invalidateQueries({})`.
  If you can't name the keys you're invalidating, you're doing too much.
- **Every dashboard widget must be lazy-considered** — does it need to
  mount above the fold? If not, defer it.
- **Every provider must minimize rerenders** — split context if a
  high-frequency value is wrapped with low-frequency siblings.
- **Performance regressions are bugs, not minor issues.** Fix or
  revert.
