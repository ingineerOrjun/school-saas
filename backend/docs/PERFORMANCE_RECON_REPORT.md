# Performance Recon Report

_Last updated: 2026-05-13 — PILOT DEPLOYMENT phase, Part 3+4._
_Scope: structural risk only — no live profiling, no load testing yet._
_Audience: anyone who'll be on-call when the pilot school logs in._

This is the static read of the codebase looking for queries / patterns
that are LIKELY to bite under production load. **Nothing here was
measured against real data.** Every item names a real file path; the
operator can validate or invalidate each against real measurements
during the first 48 hours of pilot traffic.

## TL;DR — what to watch on day 1

| Watch | Where | Expected breakpoint |
| --- | --- | --- |
| `/dashboard` cold load | DashboardService.getSummary | ~10 parallel queries; p95 ≤ 500ms |
| Fee-due rollup query | DashboardService line 197 | Could slow at 500+ payments / school |
| Marksheet grid render | ResultService.getStudentReport | Composite index gap (see §3.1) |
| `PlatformAuditEvent` write volume | platform-audit.service | Append-only, grows ~5-20 rows/day/school |
| Backup duration | BackupService cron 03:00 UTC | Should complete in < 5 min for pilot |

## 1. Migration safety

Reviewed every migration under `backend/prisma/migrations/`. **No
unsafe patterns found.** Specifically:

- No `ALTER TABLE` / `DROP COLUMN` without `IF EXISTS` / `IF NOT EXISTS`.
- No data-modifying `UPDATE` in a structural migration.
- All audit-additions (archive triplet, promotion attribution) are
  ADD COLUMN + nullable + idempotent.
- Index creations use Prisma's default path (not `CONCURRENTLY` —
  acceptable for the small pilot dataset; reconsider for the
  multi-school production deploy if any single table grows beyond
  ~100K rows).

Verdict: **PASS** for pilot.

## 2. Index coverage on high-traffic models

Read directly from `backend/prisma/schema.prisma`.

| Model | Indexes | Verdict |
| --- | --- | --- |
| `Student` | `[schoolId]`, `[classId]`, `[sectionId]`, `[schoolId, registrationNumber]` (unique), `[schoolId, archivedAt]` | ✅ Strong |
| `Exam` | `[schoolId]`, `[schoolId, sessionId]`, `[schoolId, archivedAt]` | ✅ Strong |
| `Attendance` | `[schoolId, date]`, `[schoolId, sessionId, date]`, `[studentId, date]` (unique) | ✅ Strong |
| `AcademicSession` | partial unique `(schoolId) WHERE isActive = true` + `[schoolId]` | ✅ Correct invariant |
| `PlatformAuditEvent` | `[schoolId, createdAt DESC]`, `[action]`, `[createdAt DESC]`, `[correlationId]` | ✅ Tenant feed is index-only |
| `Notification` | `[schoolId, createdAt DESC]`, `[userId, createdAt DESC]`, `[severity, createdAt DESC]` | ✅ Strong |
| `StudentAcademicRecord` | `[studentId, sessionId]` (unique), `[sessionId]`, `[classId]`, `[schoolId]` | ✅ Strong |
| `Result` | `[examId]`, `[studentId]`, `[sessionId]`, `[studentId, subjectId]` (unique) | ⚠️ See §3.1 |

### 2.1 Result composite-index gap (LOW-MEDIUM, monitor)

The marksheet-grid lookup pattern in
`exams/result.service.ts` does:

```ts
prisma.result.findMany({
  where: { examId, studentId: { in: [...] } },
  include: { subject: true, student: true },
})
```

The available indexes are `[examId]` alone and `[studentId, subjectId]`
(unique). Postgres will pick one and post-filter the other — fine for
a single exam × class roster (≤ 100 students × ≤ 10 subjects = ≤ 1000
rows). It becomes a hotspot if a single exam grows past ~5000 result
rows.

**Recommendation**: add `@@index([examId, studentId])` in a future
additive migration. Not required for the pilot (single school, ≤ 1000
students, ≤ 5 exams/year).

## 3. Unbounded `findMany` calls

Audited every `findMany(` in `backend/src`. **3 sites without `take:`**,
each justified:

| Site | Why unbounded is OK |
| --- | --- |
| `dashboard.service.ts:445` | Aggregation rollup; comment documents intent. Bounded by school size (max ~2000 students). |
| `promotion-preview.service.ts:176` | Bounded by `studentIds` from the payload (capped via DTO). |
| `attendance.service.ts` (×2) | Bounded by class roster (typically ≤ 60 students). |

Verdict: **PASS**. No genuine DOS vectors from list endpoints.

## 4. Pagination enforcement

Every list endpoint accepting `@Query('pageSize')` caps at the service
layer (`Math.min(100, …)` or `pageSize ?? 25`). Confirmed sites:

- `fees.controller.ts:188` (payments) — caps at 100
- `notification-center.controller.ts:51`
- `me-notifications.controller.ts:93`
- `platform.controller.ts:89` (schools) + `:530` (audit)
- `school-audit.controller.ts:64`

**Verdict**: **PASS**. No unbounded-pagination DoS surface.

## 5. Deeply nested `include` patterns

Scanned `include: {` patterns ≥ 3 levels deep. Worst offenders:

| Site | Depth | Risk |
| --- | --- | --- |
| `exam.service.ts:206` (getAnalytics) | 2-3 | LOW — bounded by subjects-per-exam (≤ 20) |
| `result.service.ts:937` (marksheet) | 2 | LOW — single student, single exam |
| `fees.service.ts:1739` (fee report) | 2-3 | LOW — bounded by per-student assignment count |

None reach 4+ levels. **Verdict**: **PASS** for pilot. Re-audit when
any single school passes 1000 students or 50 exam-subjects.

## 6. Dashboard fan-out

`DashboardService.getSummary` runs **~10 parallel queries** for a
single dashboard load:

1. School metadata
2. Total students count
3. Total teachers count
4. Total classes count
5. Today's attendance count
6. Fees collected (sum)
7. Fees outstanding (sum)
8. General credit (sum)
9. Recent students (capped at 8)
10. Fee-due rollup (this one is the hotspot)

Item 10 is the watch item — it scans all assignments × payments for
the school. Bounded by school size for pilot; could grow under load
in a multi-school deployment.

**Recommendation**: add `@@index([schoolId, studentId])` to `Payment`
in a future additive migration. Not blocking for pilot.

## 7. Archive-table growth

`PlatformAuditEvent` is **append-only**. There is NO retention sweep
on this table in `CleanupService`. For a single pilot school, growth
rate is ~5-20 rows/day, so 1-year volume is ~5-7K rows — trivially
small. For a multi-school production deploy, this becomes meaningful.

**Recommendation**: add a daily retention sweep that purges rows
older than 24 months in a future phase. Defer for pilot.

## 8. Background jobs / cron

| Cron | Schedule | Service | Risk for pilot |
| --- | --- | --- | --- |
| `backup-daily` | `0 3 * * *` | BackupService | Spans full DB dump — pilot DB is small, expect < 1 minute |
| `backup-retention-sweep` | `0 4 * * *` | BackupService | Deletes expired backup files |
| `cleanup-daily` | `30 3 * * *` | CleanupService | Sweeps notifications / sessions / incidents / jobs |
| `queue-health-watch` | `*/5 * * * *` | QueueHealthWatcherService | Lightweight queue depth check |
| `maintenance-window-sweep` | `* * * * *` | MaintenanceWindowService | Once-per-minute window check |
| `subscription-expiring` | `0 9 * * *` | SubscriptionExpiringService | Bounded by subscription count (1 row for pilot) |

All bounded. None scan unbounded tables. **Verdict**: **PASS**.

## 9. Long-running transactions

13 callsites are wrapped in `txWithRetry` with explicit `slowMs`
thresholds. The ones with `slowMs ≥ 3000` (legitimately slow under
load):

| Label | slowMs | Service |
| --- | --- | --- |
| `commit-import` | 5000 | productization/import.service.ts |
| `bulk-create-students` | 5000 | student.service.ts |
| `promote-students` | 3000 | promotion.service.ts |
| `bulk-save-marks` | 3000 | exams/result.service.ts |
| `grid-save-marks` | 3000 | exams/result.service.ts |
| `mark-attendance-bulk` | 3000 | attendance.service.ts |

Each is a legitimate bulk-write. The slow-tx warning logs in dev
when exceeded; production tolerates the duration.

Telemetry counters via `tx-telemetry.ts` + `tx-rolling-window.ts`
will surface real-world `slowMs` breaches via the operations cockpit.

**Watch**: if any label shows `retries > 0` or `exhausted > 0` in the
first 48 hours of pilot traffic, investigate contention.

## 10. Frontend polling intervals

All `refetchInterval` call sites poll at ≥ 20 seconds (mostly 30-60s):

- `/platform/operations/page.tsx` — 12 separate polls, 20-60s
- `/platform/health/page.tsx` — 60s
- `AnnouncementBanner.tsx` — 60s
- `notifications.tsx` — 30s unread badge

No 5-second polling. The previous-phase 429 storm is structurally
prevented.

## 11. React Query governance

`frontend/lib/query-client.ts` enforces:
- `staleTime` default 1m (`SEMI_STATIC`)
- `refetchOnWindowFocus: false`
- `refetchOnReconnect: true` (debounced by session-watchdog)
- `refetchOnMount: false`
- `retry: 1` (mutations: 0)
- `networkMode: 'online'`

Dev wrapper warns on `invalidateQueries({})` (no key — would nuke
entire cache). Verified intact.

**Verdict**: **PASS**. No request-storm vectors remain at the API
layer.

## 12. What WAS NOT measured

Be honest about gaps:

- **No real-data load test** has been run. Numbers above are
  structural, not measured.
- **No EXPLAIN ANALYZE** on production data — index choices are
  by-inspection, not by query plan.
- **No flame graph** or profiler output exists for `/dashboard`,
  marksheet, or attendance pages.
- **No N+1 detector** is wired (we have `request-pressure`
  dev-side, but it counts requests, not query patterns).

These are POST-LAUNCH validation tasks. Watch the operations
cockpit's request panel (p95, p99, error rate) over the first 48
hours and follow the slow-endpoint signal back to a real query.

## Hot list — order of attention if/when slowness appears

1. **`/dashboard` slow?** Open the request panel, identify which of
   the 10 parallel queries is the laggard. Most likely candidate:
   the fee-due rollup. Add `@@index([schoolId, studentId])` on
   `Payment` if confirmed.
2. **Marksheet slow?** Add `@@index([examId, studentId])` on
   `Result` (§2.1).
3. **Attendance bulk save slow?** `mark-attendance-bulk` already
   txWithRetry-wrapped with `slowMs: 3000`. If the telemetry
   counter shows retries, contention is real — investigate parallel
   roster edits.
4. **Audit feed slow?** `[schoolId, createdAt DESC]` index covers
   it; if slow it means table is much bigger than expected — start
   the retention-sweep work (§7).
5. **Promotion run slow?** `promote-students` has `slowMs: 3000`;
   a slow run with no contention means roster size is the issue.
   Acceptable up to ~2000 students; chunk into batches above that.

None of these are pre-launch blockers. **Profile first, optimize
second.**
