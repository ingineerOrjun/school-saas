# Transaction Patterns

_Last updated: 2026-07-19 — Phase RELIABILITY-II Part 8._
_Audience: backend engineers writing or reviewing multi-write code._

Every multi-write code path in this codebase goes through one of
three transaction patterns. This doc names them, says when to use
each, and lists the call sites that follow each one — so the next
contributor doesn't invent a fourth.

## Pattern A — `txWithRetry` callback (DEFAULT)

The standard pattern. Use this for **every** multi-write operation
unless one of the more specialized patterns applies.

```ts
import { txWithRetry } from '../common/db/tx-retry';

const result = await txWithRetry(
  this.prisma,
  async (tx) => {
    // sequential multi-write logic
    const created = await tx.payment.create({ ... });
    await tx.payment.update({ where: { id: source.id }, data: { ... } });
    return created;
  },
  { label: 'issue-refund', slowMs: 1500 },
);
```

Call sites following this pattern today (after RELIABILITY-II):

| Site | Label |
| --- | --- |
| `promotion.service.ts:run` | `promote-students` |
| `academic-session.service.ts:create` | `create-session` |
| `academic-session.service.ts:setActive` | `activate-session` |
| `teaching-assignment.service.ts:saveBulk` | `save-teaching-assignment` |
| `notifications/notification.service.ts:enqueue` | `enqueue-notification` |
| `auth/auth.service.ts:registerAdmin` (inner) | `register-admin` |
| `productization/import.service.ts:commit` | `commit-import` |
| `student/student.service.ts:bulkCreate` | `bulk-create-students` |
| `attendance/attendance.service.ts:mark` | `mark-attendance-bulk` |
| `exams/result.service.ts:save` | `save-marks` |
| `exams/result.service.ts:bulkSaveByClass` | `bulk-save-marks` |
| `exams/result.service.ts:bulkSaveGridOnly` | `grid-save-marks` |
| `fees/fees.service.ts:refund` | `issue-refund` |

13 sites total. Every one of these:

- Auto-retries on P2034 (serialization / deadlock).
- Records telemetry (attempts, retries, exhaustion, classified
  failures) via `tx-telemetry.ts`.
- Logs slow-tx warnings in dev when callback exceeds `slowMs`.
- Wraps the callback's audit emit OUTSIDE the transaction — see
  Pattern C.

## Pattern B — read-only `$transaction([find, count])`

For paginated reads that need a consistent snapshot across a
findMany + a count. The array form is correct here — there's no
write to roll back and Postgres treats the pair as a single
read-only snapshot.

```ts
const [rows, total] = await this.prisma.$transaction([
  this.prisma.platformAuditEvent.findMany({ where, ... }),
  this.prisma.platformAuditEvent.count({ where }),
]);
```

Call sites following this pattern:

| Site | Why array form is appropriate |
| --- | --- |
| `platform-audit.service.ts:list` / `listForSchool` | Snapshot-consistent page + count |
| `fees.service.ts:listPaymentsPaginated` | Same |
| `sessions/session.service.ts:countActive` | KPI counter pair |

**Do NOT** migrate these to `txWithRetry`. Retry-on-P2034 is
meaningless for read-only work, and the helper's slow-tx warning
would fire on legitimate paginated reads against large tables.

## Pattern C — audit emit OUTSIDE the transaction

Universally followed. The audit row needs the post-commit state and
must not roll back the underlying mutation when audit logging
soft-fails:

```ts
// 1. Mutate.
const updated = await txWithRetry(this.prisma, async (tx) => { ... }, {
  label: '...',
});

// 2. Emit audit AFTER commit. PlatformAuditService.record swallows
//    all errors internally — never rethrow them.
await this.audit.record({
  action: PlatformAuditAction.SOMETHING,
  schoolId,
  actor: { ... },
  target: { ... },
  before,
  after,
});
```

This pattern is enforced by convention, not by code. Every PR that
adds a new mutation MUST follow it. The `FAILURE_HANDLING_GUIDELINES.md`
discusses why.

## Anti-patterns we forbid

### Don't: raw `$transaction(async tx => ...)` without retry

There is **zero** justification for using `prisma.$transaction(async
tx => ...)` directly in new code. If you find one in old code, it's
a TODO — `txWithRetry` is the upgrade path.

### Don't: array form for mixed read/write

```ts
// ❌ Wrong — the create is a write, the findMany is a read; the
//    array form doesn't guarantee they see consistent state, AND
//    a write conflict can't retry.
const [created, others] = await prisma.$transaction([
  prisma.student.create({ ... }),
  prisma.student.findMany({ ... }),
]);

// ✅ Right — wrap in a callback with retry.
const { created, others } = await txWithRetry(
  prisma,
  async (tx) => ({
    created: await tx.student.create({ ... }),
    others: await tx.student.findMany({ ... }),
  }),
  { label: 'create-and-list-students' },
);
```

### Don't: catch P2034 yourself

The helper retries it. If you catch P2034 in your callback, you've
defeated the helper:

```ts
// ❌ Wrong
try {
  await tx.something.create({ ... });
} catch (e) {
  if (e.code === 'P2034') {
    // The helper would have retried this. By catching it here you
    // turn a transient error into a silent partial state.
  }
}
```

Let P2034 bubble out of the callback. The helper handles it.

### Don't: parallelize writes inside a callback

```ts
// ❌ Wrong — Promise.all inside a transaction looks parallel but
//    Prisma's transaction client serializes anyway, and the syntax
//    misleads future readers into thinking it's safe to introduce
//    real parallelism later.
await Promise.all(entries.map(e => tx.result.upsert({ ... })));

// ✅ Right — explicit sequential for-loop.
for (const e of entries) {
  await tx.result.upsert({ ... });
}
```

## When to override `slowMs`

The default 1500ms is right for almost everything. Override when:

- The operation is legitimately slow under normal load (bulk
  imports, full-class attendance writes).
- Examples in the repo:
  - `commit-import` → 5000ms
  - `bulk-create-students` → 5000ms
  - `promote-students` → 3000ms
  - `bulk-save-marks` / `grid-save-marks` → 3000ms

Don't override `slowMs` to mask an N+1 inside the callback. The
warning exists to surface those.

## The retry budget

Default: 3 attempts. Don't override past 5. The reasoning:

- 3 attempts × ~20-160ms backoff covers 99% of real deadlock
  windows on a healthy database.
- Beyond 5 attempts you're masking a real contention issue. The
  telemetry counter (`transactionExhausted{label}`) is how an
  operator sees that.

## Audit ordering inside a callback

When the transaction itself updates an audit-relevant column AND
you want to record a `before` snapshot:

```ts
// 1. Read the BEFORE state inside the transaction (consistent
//    snapshot).
const before = await txWithRetry(
  this.prisma,
  async (tx) => {
    const row = await tx.student.findUniqueOrThrow({ where: { id } });
    await tx.student.update({ where: { id }, data: { archivedAt: now } });
    return row;
  },
  { label: 'archive-student' },
);

// 2. Emit audit AFTER commit, using the captured `before`.
await this.audit.record({ before, after: { archivedAt: now }, ... });
```

`StudentService.archive` and `StudentService.restore` are the
reference implementations.

## Telemetry counters

`common/db/tx-telemetry.ts` exposes four process-local counters:

- `attempts{label}` — every attempt, success or fail.
- `retries{label}` — every retry that fired.
- `exhausted{label}` — every transaction that ran out of retries.
- `failures{label, reason}` — every terminating-in-error transaction,
  classified by reason (`p2034`, `p2002`, `p2025`, `validation`,
  `other`).

Read them via `snapshotTransactionTelemetry()`. The operations
cockpit + dev pressure panel surface them. Reset between tests via
`_resetTransactionTelemetry()`.

## PR review checklist

- [ ] Callback-form `txWithRetry` used (Pattern A) for multi-write.
- [ ] Array form only for read-only paginated `[findMany, count]` (Pattern B).
- [ ] Audit emit AFTER the transaction (Pattern C).
- [ ] No raw `prisma.$transaction(async tx)` calls remaining in new code.
- [ ] No catch of P2034 inside the callback.
- [ ] No `Promise.all` over writes inside the callback.
- [ ] `slowMs` overridden only with a justification comment.
- [ ] Label is stable + kebab-cased + meaningful for telemetry grouping.
