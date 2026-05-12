# Stabilization Phase — Deferred Items Report

_Phase PLATFORM STABILIZATION Part 10._
_Last updated: 2026-07-16._

This document is **explicitly** the list of work that was scoped out
of the Platform Stabilization phase. Nothing was silently skipped.
Each item names what was deferred, why, the operational risk if
nothing is done, and the recommended next-phase priority.

## Format

| Item | Operational risk | Next-phase priority |
| --- | --- | --- |

- **Operational risk**: `LOW` / `MEDIUM` / `HIGH` — how badly things
  break if a real school is running production today.
- **Next-phase priority**: a coarse ordering. `P0` = next phase
  must include it; `P1` = next phase should include it; `P2` =
  desirable but no urgency.

---

## 1. Adoption of `txWithRetry` across existing call sites

**Shipped**: `common/db/tx-retry.ts` — deadlock-safe transaction
wrapper with capped-jitter retry, slow-tx dev warning, soft-audit
hook on final failure.

**Deferred**: migrating the ~18 services that already use
`prisma.$transaction` directly. They keep working today —
`txWithRetry` is purely additive. Migration is mechanical (wrap the
existing callback) but touches ~18 files, which is too many for one
review-able patch in this phase.

| Risk | Priority |
| --- | --- |
| MEDIUM — under high concurrency a P2034 will surface as a 500 instead of an automatic retry | P1 |

**Recommended next-phase move**: take the 5 hottest transactions
(promotion run, attendance bulk overwrite, archive/restore, marks
publish, student bulk import) and migrate them. Leave the rest for a
follow-up tidy phase.

## 2. Duplicate-mutation detector in `RequestPressurePanel`

**Shipped**: the panel already surfaces "duplicates within 5s" per
endpoint family.

**Deferred**: a dedicated "duplicate MUTATION" lane that filters by
HTTP method. The instrumentation in
`frontend/lib/request-pressure.ts` only tracks `path`, not method;
adding method tracking is a small but non-trivial change to a hot
code path.

| Risk | Priority |
| --- | --- |
| LOW — mutations rarely loop; the existing duplicate signal already catches the loud cases | P2 |

**Recommended next-phase move**: a one-file change to add `method`
to the tracked tuple, plus a 20-line dedicated section in the panel.

## 3. AuditStamp rollout across all rows (Part 8)

**Shipped**: the existing AuditStamp + ArchivedBadge primitives are
already used on Student / Exam rows.

**Deferred**: extending "last updated by", "published by", "locked
by", "promotion executed by" to every list (results ledger,
attendance roster, payment receipts, fee structures). The schema
already carries the fields; what's missing is the UI placement.

| Risk | Priority |
| --- | --- |
| LOW — operational confidence improves, but no data is lost without it | P1 |

**Recommended next-phase move**: pick the three highest-traffic
list pages (results ledger, payments, attendance) and add a
compact "Updated · 3h ago · by ada@school" footer on each row.

## 4. Test expansion (Part 9)

**Shipped**: existing 158-test backend suite continues to pass.

**Deferred**: the new test categories the spec named —

- Concurrency tests (two operators promoting at once)
- Reconnect tests (online/offline event handling)
- Archive/restore round-trip integration tests
- Throttling regression tests
- Auth-expiry tests (JWT mid-flight expiry)
- Lock-state tests (publish/unpublish/lock combinations)

Each of these is a separate test harness with non-trivial setup
(e.g. concurrency tests need a separate worker pool; throttle tests
need a clock-mock). Stacking them onto this phase would have
expanded scope by 2-3×.

| Risk | Priority |
| --- | --- |
| MEDIUM — a regression could land undetected | P0 |

**Recommended next-phase move**: dedicate a sub-phase to test
infrastructure. Start with archive/restore (simplest) + lock-state
(highest business impact); the others follow.

## 5. Cron-driven integrity check digest

**Shipped**: `/system/integrity-report` returns an on-demand report.

**Deferred**: a nightly cron that runs the check across every tenant
and emails the digest to platform operators. The wiring (cron +
notification template) is straightforward; the deferred part is
deciding the digest format + alert routing.

| Risk | Priority |
| --- | --- |
| LOW — admins can already pull the report manually | P2 |

**Recommended next-phase move**: add a 02:00 UTC cron that
generates a per-tenant report and writes any `error`-severity
findings into a new `IntegrityIncident` table for ops to review.

## 6. P2002 / P2025 telemetry

**Shipped**: the http exception filter already maps these to
4xx responses with helpful copy.

**Deferred**: a counter / time series of "P2002 collisions per
hour per endpoint". Useful for spotting endpoints that are doing
"check-then-create" instead of upsert.

| Risk | Priority |
| --- | --- |
| LOW — current behavior is correct; this is observability polish | P2 |

## 7. Frontend reconnect-debounce wired to React Query

**Shipped**: `session-watchdog` debounces the `online` event in 1.5s
and exposes an `onReconnect` callback.

**Deferred**: piping that callback into a fine-grained invalidation
strategy (only invalidate STALE queries, only after the network
settles for 3s, etc.). Today `refetchOnReconnect: true` is good
enough — the debounce already prevents the bursty wake-from-sleep
pattern.

| Risk | Priority |
| --- | --- |
| LOW — the cheap fix is already in place | P2 |

## 8. Operational dashboard for school admins (Part 6 expansion)

**Shipped**: `/settings/system` now exposes Backup status + Integrity
report.

**Deferred**: the spec mentioned "recent failed operations / failed
sync counts / recent throttling events / slow endpoint counts /
queued jobs snapshot / audit volume / archive counts". Several of
these (queue depth, throttling) live in operator-tier cockpit
(`/platform/operations`); exposing them at school-admin scope would
require new tenant-scoped aggregator queries.

| Risk | Priority |
| --- | --- |
| LOW — admins can see incidents, and the SUPER_ADMIN cockpit has the rest | P1 |

**Recommended next-phase move**: add two cards: `Recent failed
operations` (filter on the existing audit log for failure codes) +
`Archive counts` (a single COUNT on archived students/exams).

## 9. Real-time integrity alerts

**Shipped**: on-demand report only.

**Deferred**: pushing critical findings (e.g.
`MULTIPLE_ACTIVE_SESSIONS`) as platform-level notifications so an
incident gets escalated automatically.

| Risk | Priority |
| --- | --- |
| MEDIUM if the partial unique index ever lapses — but that's not happening today | P1 |

## 10. Backup restore from API (deliberately NOT shipped)

This is **NOT** deferred — it's intentionally out of scope forever.
Restore-from-API is operationally dangerous (in-flight writes, FK
conflicts, partial state). The disaster-recovery runbook
(`docs/disaster-recovery.md`) is the only supported path.

Listed here so a future contributor doesn't propose it without
reading the existing reasoning.

---

## Phase summary

| Part | Status |
| --- | --- |
| 1 — Permission hardening + helpers | SHIPPED (helpers added; existing controllers already consistent) |
| 2 — Long-session reliability | SHIPPED |
| 3 — Database safety (tx-retry helper) | SHIPPED (helper); ROLLOUT DEFERRED |
| 4 — Backup readiness + docs | SHIPPED |
| 5 — Performance governance v2 | PARTIAL (docs shipped; one panel detector deferred) |
| 6 — Operational dashboard | PARTIAL (backup + integrity cards shipped; remaining surfaces deferred) |
| 7 — Data integrity verification | SHIPPED |
| 8 — UX trust surfaces | PARTIAL (existing AuditStamp + ArchivedBadge unchanged; rollout deferred) |
| 9 — Test + failure hardening | DEFERRED (P0 next phase) |
| 10 — Deferred items report | SHIPPED (this document) |

## Non-negotiables — verified

1. Backend authority is final. ✅
2. Tenant isolation is sacred. ✅
3. All destructive operations remain auditable. ✅
4. Locks / publication / archive states enforced server-side. ✅
5. No silent failure paths. ✅ (every soft-fail is logged or returned as a structured error)
6. No speculative optimization. ✅ (only profile-driven additions)
7. Diagnostics dev-safe with zero prod overhead. ✅ (`NODE_ENV` gates)
8. Additive migrations only. ✅ (this phase added zero schema changes)
9. Preserve architecture patterns. ✅
10. Every new admin action improves operator confidence. ✅
