# Phase α — Production Foundations

## Scope (committed)

1. **Real backup engine** — `pg_dump` to local disk with retention + ops UI. Replaces the Phase 22 stub.
2. **Conflict resolution for actual cases** — `lastKnownVersion` enforcement on attendance.mark + payment.create. Returns 409 + surfaces in sync inspector.
3. **Background health watcher** — periodic sweep that detects stalled queues + stuck workers, emits SUPER_ADMIN notifications.
4. **Shared `<PrintShell>` primitive** — extract A4-safe + branded print chrome. Apply to fee receipts.
5. **Tenant isolation runtime helper** — `assertSchoolScope()` utility + documented convention. Spot-checked on 5 controllers.

## Out of scope (defer)

- Timetable, Homework, Parent portal — pick path β only after a real customer dictates direction.
- DB perf pass, advanced analytics, scheduled reports — premature without real load.
- Asset storage abstraction — local disk is fine for first customer.
- Full mobile audit, full a11y pass — need real-device QA, not text editing.
- Full document engine (admit cards, marksheets, TCs) — `<PrintShell>` primitive lands; per-doc templates ship as needed.
