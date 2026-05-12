# Phase RELIABILITY — Final Report

_Last updated: 2026-07-18._

This document is the deliverable required by Phase RELIABILITY's
"Required Output" section: exact files changed, tests added, metrics
improved, deferred items, remaining risks, recommended next phase.

## 1. Exact files changed

### Backend — transaction retry rollout (Part 1)

Migrated 7 callback-form transactions to `txWithRetry`:

| File | Label | Risk tier |
| --- | --- | --- |
| `promotion/promotion.service.ts` | `promote-students` | HIGH |
| `academic-session/academic-session.service.ts` (create) | `create-session` | MEDIUM |
| `academic-session/academic-session.service.ts` (setActive) | `activate-session` | MEDIUM |
| `teaching-assignment/teaching-assignment.service.ts` | `save-teaching-assignment` | MEDIUM |
| `notifications/notification.service.ts` | `enqueue-notification` | MEDIUM |
| `auth/auth.service.ts` (registerAdmin inner tx) | `register-admin` | LOW |
| `productization/import.service.ts` | `commit-import` | LOW |

### Backend — tests (Part 2)

- `common/db/tx-retry.spec.ts` (new) — 16 tests
- `system/integrity-check.service.spec.ts` (new) — 9 tests
- `student/student-archive.service.spec.ts` (new) — 12 tests

### Backend — helper docstring tightened

- `common/db/tx-retry.ts` — clarified `onFinalFailure` semantics
  (fires on any final failure, including first-try non-transient
  errors).

### Docs added (Part 8)

- `backend/docs/TESTING_GUIDELINES.md`
- `backend/docs/CONCURRENCY_RULES.md`
- `backend/docs/CACHE_INVALIDATION_RULES.md`
- `backend/docs/FAILURE_HANDLING_GUIDELINES.md`
- `backend/docs/RELIABILITY_PHASE_REPORT.md` (this file)

## 2. Tests added

37 new tests across 3 new files:

| File | Tests | Covers |
| --- | --- | --- |
| `tx-retry.spec.ts` | 16 | Retry semantics, P2034 vs P2002, hook contract, maxAttempts, slow-tx options forwarding |
| `integrity-check.service.spec.ts` | 9 | Clean baseline, duplicate detection, NO/MULTIPLE active sessions, exam missing session, promotion linkage info, tenant isolation |
| `student-archive.service.spec.ts` | 12 | Archive emits audit, archive idempotent, reason trim/cap/null, NotFound on cross-tenant, restore emits audit, restore idempotent, update rejects archived, findAll default filter / archived: true / archived: 'all' |

**Total backend suite: 158 → 195 passing.**

## 3. Metrics improved

| Metric | Before | After |
| --- | --- | --- |
| Backend tests | 158 | 195 (+37) |
| Test suites | 13 | 16 (+3) |
| `prisma.$transaction` callsites retry-aware | 0 of 16 | 7 of 16 |
| Governance docs | 2 (retention-policy, performance-baselines) | 6 (+4) |
| Slow-tx dev warnings | none | 7 (one per migrated transaction) |

`onFinalFailure` is also now hooked into 7 transactions — emitting
structured telemetry to NestJS Logger when a transaction ultimately
fails, before rethrowing the original error.

## 4. Deferred items + reasons

### 4.1 Array-form transaction migrations (Part 1 follow-up)

**Deferred call sites:**

- `student.service.ts:bulkCreate` (array form, bulk student import)
- `attendance.service.ts:markAttendanceBulk` (array form)
- `result.service.ts × 3` (publish-marks, bulk-save, grid-save —
  all array form)
- `fees.service.ts:issueRefund` (array form, low volume)

**Reason:** Migrating array-form `prisma.$transaction([...])` to
callback-form is a **behavior change**. The array form may parallelize
queries; the callback form serializes them. Each call site needs a
correctness review before flipping, plus likely chunking work for
the bulk variants. Stacking this onto Part 1 would have exceeded
review-able scope.

**Risk:** MEDIUM. Under high concurrency a P2034 surfaces as 500
instead of automatic retry. Operationally fine today.

**Priority:** P1 next phase.

### 4.2 UI consistency hardening (Part 3)

**Deferred entirely.** This is an audit-style walk-through of every
dialog, toast, empty state, and disabled-button explanation in the
frontend — meaningful only when paired with concrete diff PRs per
inconsistency found.

**Reason:** Without a measured catalog of inconsistencies, a "we
audited it" claim is vapor. The right shape for this work is a
dedicated UX-pass phase that pairs an inventory with the fixes.

**Risk:** LOW. Existing surfaces are functional; consistency
issues are aesthetic, not operational.

**Priority:** P2 next phase or after.

### 4.3 Request + cache stability audit (Part 4)

**Partially shipped via the CACHE_INVALIDATION_RULES.md doc.** The
hands-on audit of every `useQuery` site is deferred.

**Reason:** The `RequestPressurePanel` already surfaces violations
in real time (red chip for reference-data duplicates). The doc
codifies the rules so future PRs are reviewable against them.
Walking every existing site for "is this canonical?" would have
expanded scope by 2-3x.

**Risk:** LOW. The detector catches new violations; the existing
ones are bounded and known (none flagged red today).

**Priority:** P2.

### 4.4 Operator trust surface rollout (Part 5)

**Deferred.** `ArchivedBadge`, `LockedBadge`, `AuditStamp` primitives
already exist and are partially used. Rolling them out across
marks / attendance / payments / promotion / archived records is a
~12-file frontend touch that didn't fit alongside the test +
migration + docs work.

**Reason:** Each surface needs context-specific placement (sidebar
vs row vs header). Not mechanically uniform.

**Risk:** LOW. Operator confidence improves with each badge; no
data integrity issue exists without them.

**Priority:** P1 next phase. Pair it with Part 3 (UI consistency).

### 4.5 Performance validation (Part 6)

**Deferred.** Real measurement requires a controlled environment
(consistent hardware, fixture data, RUM sampling). The
`PERFORMANCE_BASELINES.md` from the prior phase records the
targets; a measurement sweep is a separate effort.

**Reason:** Profile-first discipline — measure before optimizing.
Without a measurement sweep, any "fix" is speculative.

**Risk:** LOW. Existing instrumentation (request-pressure panel,
operations cockpit) provides ongoing signal.

**Priority:** P2.

### 4.6 Failure mode review (Part 7)

**Partially shipped via FAILURE_HANDLING_GUIDELINES.md.** The
hands-on audit of every existing failure copy is deferred.

**Reason:** Same as Part 3 — the right shape is a dedicated copy
pass paired with concrete diffs. The doc captures the rules.

**Risk:** LOW. Existing copy is functional; new copy follows the
guidelines.

**Priority:** P2.

### 4.7 Concurrency integration tests

**Deferred.** The unit tests for `txWithRetry` validate the retry
contract in isolation. End-to-end "two operators promoting at once"
tests need a real database harness, which doesn't exist in this
repo today.

**Risk:** MEDIUM. The retry contract is unit-validated; real-world
concurrency contention is observable via slow-tx warnings + the
operations cockpit, but not yet automated.

**Priority:** P0 next phase. The biggest gap.

## 5. Remaining architectural risks

### 5.1 No real-database integration suite

This repo has unit tests + shape-mocks, no `*.integration.spec.ts`.
For multi-row state transitions (promotion, marks publish), the
mocks miss real-world contention modes (deadlocks, FK cascades
under load).

**Mitigation today:** unit tests + manual operator review +
production audit log.

**Long-term fix:** opt-in integration suite with testcontainers or
similar.

### 5.2 Array-form transactions not retry-aware

See section 4.1. Five of the six HIGH-risk array-form sites are
unmigrated. P2034 surfaces as 500. The operator runs out of
options when this happens.

**Mitigation today:** Postgres deadlocks are rare on small-to-medium
tenants; the failure mode is observable via the operations cockpit.

**Long-term fix:** P1 migration in the next phase.

### 5.3 Background workers don't all use txWithRetry

The job-queue worker code path was not audited in this phase. If a
background job uses `prisma.$transaction` directly, it inherits the
same P2034 risk as the unmigrated array-form sites.

**Mitigation today:** background jobs have their own per-job retry
budget (default 3 attempts in `JobQueueService.enqueue`), which
covers the failure case at a coarser granularity.

**Long-term fix:** audit + migrate as part of the array-form
follow-up.

### 5.4 No client-side load test

The front-end refetch governance is rule-based, not measurement-
based. If a new query slips past the rules, it lands in production
before the panel sees it. RequestPressurePanel is dev-only.

**Mitigation today:** PR review + the dev panel.

**Long-term fix:** a per-tenant /platform/operations panel for
request volume by family (already exists for the operator tier;
school-tier doesn't have one).

### 5.5 Audit-emit failures are silent in production

`PlatformAuditService.record` swallows + logs errors. In production
the logs are the only signal. There is no alerting on missing
audit rows.

**Mitigation today:** the soft-fail policy is documented and
intentional (school suspension is more important than its audit
row).

**Long-term fix:** a DLQ + alert path (called out in the prior
Phase 4 deferred report).

## 6. Recommended next phase

**Phase RELIABILITY-II — Integration Tests + Array Migration**

1. **Integration test harness** (P0). testcontainers + a small fixture
   set. Target the 5 highest-risk flows: promotion, archive/restore,
   marks publish, fee payment, student bulk import.

2. **Array-form transaction migration** (P0). Convert the 5 HIGH-risk
   array-form sites to callback-form, wrapped in `txWithRetry`. Pair
   each conversion with an integration test from step 1.

3. **Concurrency tests for uniqueness invariants** (P1). At minimum:
   parallel `setActive`, parallel `registerAdmin` with the same
   school code, parallel promotion.

4. **Operator trust surface rollout** (P1). The deferred Part 5
   work: `LockedBadge` / `ArchivedBadge` / `AuditStamp` across
   marks, attendance, payments, promotion, archived records.

5. **Failure copy audit** (P2). Walk every error path and verify it
   matches `FAILURE_HANDLING_GUIDELINES.md`. Diff the copy where it
   drifts.

That sequence cleanly closes the gaps this phase opened and the
ones it documented.

---

## Phase summary table

| Part | Outcome |
| --- | --- |
| 1 — Transaction retry rollout | SHIPPED (7 callback-form sites); 6 array-form deferred |
| 2 — High-value test expansion | SHIPPED (37 new tests, 158 → 195) |
| 3 — UI consistency hardening | DEFERRED (P2) |
| 4 — Request + cache stability | DOC SHIPPED; site audit deferred (P2) |
| 5 — Operator trust surfaces | DEFERRED (P1) |
| 6 — Performance validation | DEFERRED (P2) — depends on measurement sweep |
| 7 — Failure mode review | DOC SHIPPED; copy audit deferred (P2) |
| 8 — Documentation + governance | SHIPPED (4 new docs) |

## Non-negotiables — verified

1. Tenant isolation preserved. ✅ (no changes to `assert-school-scope.ts`)
2. Audit integrity preserved. ✅ (all migrated transactions emit audit AFTER commit)
3. Additive migrations only. ✅ (zero schema changes this phase)
4. No silent unlocks/unarchives. ✅
5. No broad cache invalidation. ✅ (rules documented in CACHE_INVALIDATION_RULES.md)
6. No throttling weakening. ✅
7. No speculative optimization. ✅
8. No architecture rewrites. ✅
9. No hidden background mutations. ✅
10. TypeScript + Jest green. ✅ (backend tsc clean, 195/195 jest passing, frontend tsc clean)
11. Operational transparency preserved. ✅
