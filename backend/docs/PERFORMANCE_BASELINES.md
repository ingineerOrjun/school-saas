# Performance Baselines

_Last updated: 2026-07-16 — Phase PLATFORM STABILIZATION Part 5._

This document records the **target** request budgets for the most-
visited pages and the diagnostic conventions the team uses to detect
regressions. It is not a SLO contract; it is a guardrail for code
review.

## 1. Per-page request budgets

Budgets are measured on a freshly-loaded page (cold cache, not a
back-button reload). Counts include every XHR / fetch the page
issues during initial render — sub-resource requests (fonts, images)
excluded. Targets are upper bounds, not goals.

| Page | Budget | Why |
| --- | --- | --- |
| `/dashboard` | ≤ 8 requests | The home page is a high-traffic surface; anything more than 8 calls on render indicates the page is doing aggregator work that should live behind a single endpoint. |
| `/students` | ≤ 4 requests | Roster + classes + permissions. More than 4 means class data isn't reusing the shared cache. |
| `/marksheet/[examId]/[studentId]` | ≤ 5 requests | Marksheet + exam + class + student + school. Print path; don't add round-trips. |
| `/attendance` | ≤ 6 requests | Roster + sessions + today's attendance. |
| `/exams` (picker) | ≤ 3 requests | Just the list + the active session + assignments (teacher only). |
| `/results/ledger` | ≤ 4 requests | Class + exam + ledger payload. |
| Promotion preview surface | ≤ 2 requests | Validation report endpoint + roster. |
| `/audit/recent` (school feed) | ≤ 2 requests | Single page-of-rows + counts. |
| `/settings/system` | ≤ 2 requests | Backup status + integrity report. |

**Diagnosis path**: open `RequestPressurePanel` (bottom-left chip,
dev only). It surfaces:

- Top 10 endpoints by call count
- Duplicate-within-5s counts (the smoking gun for cache misses)
- Reference-data duplicates (always a bug)
- Inter-call gap (low values = polling too fast)

If a page exceeds its budget, the panel tells you which endpoint
fired more than expected.

## 2. Backend response-time targets

These are p95 targets measured against the in-process metrics
middleware (`common/observability/request-metrics.middleware.ts`).
Numbers assume the dev DB on a developer laptop; production should
beat these comfortably.

| Class of endpoint | p95 target |
| --- | --- |
| Authenticated read (single row by id) | ≤ 50ms |
| Authenticated list (paginated, ≤ 100 rows) | ≤ 200ms |
| Aggregation read (analytics, ledger) | ≤ 500ms |
| Write (create / update single row) | ≤ 200ms |
| Bulk write (transaction, ≤ 200 rows) | ≤ 1.5s |
| Promotion preview | ≤ 800ms |
| Promotion run (executes) | ≤ 5s |

Slow-transaction warnings fire automatically in dev when a
`txWithRetry` callback exceeds 1500ms — see
`common/db/tx-retry.ts` for the implementation. The warning is a
nudge, not a hard limit; a legitimately slow promotion run still
completes.

## 3. Frontend governance defaults

These are the cache-tier choices baked into `lib/query-client.ts`:

| Tier | Stale | Use for |
| --- | --- | --- |
| `REFERENCE_DATA` | 10m | Classes, sections, subjects, school settings |
| `SEMI_STATIC`    | 1m  | Dashboards, analytics summaries |
| `LIVE_OPERATOR`  | 30s | Notifications, audit feed |
| `LIVE_HEALTH`    | 15s | Operator pulse, queue depth |
| `ALWAYS_FRESH`   | 0   | Read-after-write confirmation |

**Default**: 1m (SEMI_STATIC). Per-query overrides via the named
constants only — never hardcode milliseconds.

**Reconnect**: `refetchOnReconnect: true`. The
`session-watchdog` (Phase PLATFORM STABILIZATION Part 2) debounces
the `online` event for 1.5s so a sleep-wake burst doesn't fire 20
parallel refetches.

**Focus**: `refetchOnWindowFocus: false`. Long-lived dashboard tabs
caused the 429 wave that triggered this whole governance discipline.

## 4. Detecting regressions

The two main signals:

1. **`RequestPressurePanel` ref-data duplicate count > 0**.
   Pre-warmed reference data shouldn't refetch within 10m. If it
   does, the consuming page isn't using the canonical hook
   (`useClasses` / `useSubjects` / etc.).

2. **`tx-retry` slow-tx warn in dev**. Any transaction taking >
   1500ms gets logged. Action: open the callback and check for an
   N+1 — almost always the culprit.

For prod regressions, the platform operations cockpit
(`/platform/operations`) carries the real telemetry: requests panel
(p95, p99, error rate per endpoint), slow-endpoint table, and the
duplicate-mutation detector. Investigation always starts there.

## 5. What NOT to optimize

- Don't add `React.memo` to a component unless RequestPressurePanel
  or the React DevTools Profiler shows it re-rendering > 30 times
  per second.
- Don't introduce route-level code splitting without first measuring
  the bundle. Most pages share enough vendor code that a chunk
  boundary won't meaningfully change interactive time.
- Don't pre-fetch on hover for routes the user might not visit; the
  React Query cache already keeps last-visited data warm.

Profile first. Memoize second. Lazy-load third — and only when one
of the first two said it would help.
