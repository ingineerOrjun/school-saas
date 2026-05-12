# Cache Invalidation Rules

_Last updated: 2026-07-18 — Phase RELIABILITY Part 8._
_Audience: frontend engineers using React Query in this codebase._

This document is the rule-set the frontend follows for cache / refetch
behavior. Every rule references a real file.

## 1. Tiered `staleTime` is mandatory

Every `useQuery` call MUST set `staleTime` via the named constants in
`lib/query-client.ts`. Direct millisecond literals are an anti-pattern:

| Tier | Stale | Use for |
| --- | --- | --- |
| `REFERENCE_DATA` | 10m | Classes, sections, subjects, school settings, sessions |
| `SEMI_STATIC` | 1m | Dashboards, analytics summaries |
| `LIVE_OPERATOR` | 30s | Notifications, audit feed |
| `LIVE_HEALTH` | 15s | Operator pulse, queue depth |
| `ALWAYS_FRESH` | 0 | Read-after-write confirmation |

If you can't pick a tier, you're probably building reference data —
default to `REFERENCE_DATA`.

## 2. Use the canonical hooks. Always.

We have **one** hook per resource. The hook owns the query key, the
staleTime, the auth gating, and the error handling.

| Resource | Canonical hook |
| --- | --- |
| Classes | `useClasses()` from `lib/classes.ts` |
| Sections | `useSections()` from `lib/classes.ts` |
| Subjects | `useSubjects()` from `lib/subjects.ts` |
| Students | `useStudents(filter?)` from `lib/students.ts` |
| Active session | `useAcademicSession()` from the provider |
| Teaching assignments | `useMyTeachingAssignments()` |

**Forbidden patterns:**

- Calling `useQuery({ queryKey: ['students'], queryFn: studentsApi.list })`
  directly — bypasses the cache slice that `useStudents` shares with
  the rest of the app.
- `useEffect(() => { studentsApi.list().then(setState) }, [])` — the
  request-pressure panel flags this immediately. Migrate to
  `useStudents()` instead.

The reference-data duplicate detector in `RequestPressurePanel` lights
up red when a non-canonical fetch hits the same family within 5s of
the canonical one. **Red chips block merge.**

## 3. Query keys live in `lib/query-keys.ts`

Hard-coded key arrays (`['students', { classId }]`) drift between
consumers. Always go through `qk.*` helpers. Adding a filter dimension
goes there and ONLY there:

```ts
// lib/query-keys.ts
students: (filters?: {
  classId?: string;
  sectionId?: string;
  q?: string;
  archived?: boolean | "all";
}) => [
  "students",
  {
    classId: filters?.classId ?? null,
    sectionId: filters?.sectionId ?? null,
    q: filters?.q ?? "",
    archived: filters?.archived ?? false,
  },
] as const;
```

The `?? null` / `?? false` normalization means `{}` and `{ classId:
undefined }` produce the same key, which means they share the same
cache entry.

## 4. Invalidation rules — never pass `{}`

The `withGovernance` wrapper in `lib/query-client.ts` warns loudly in
dev if you call:

```ts
qc.invalidateQueries({}); // ⚠ NUKES THE ENTIRE CACHE
qc.invalidateQueries();   // ⚠ SAME
```

Always pass a key. Patterns:

```ts
// Invalidate ONE filter slice:
qc.invalidateQueries({ queryKey: qk.students({ classId }) });

// Invalidate the entire students cache (all filters):
qc.invalidateQueries({ queryKey: ['students'] });

// Invalidate multiple resources in parallel:
await Promise.all([
  qc.invalidateQueries({ queryKey: ['students'] }),
  qc.invalidateQueries({ queryKey: qk.classes() }),
]);
```

Choose the **narrowest** key that covers the affected slices. The
students page archive flow uses `['students']` (covers both active
and archived tabs) — that's correct because both views can change
on a single archive.

## 5. Don't refetch on focus. Don't refetch on mount.

`lib/query-client.ts` sets:

```ts
refetchOnWindowFocus: false,
refetchOnMount: false,
refetchOnReconnect: true,
```

Background-tab → foreground-tab does **NOT** refetch. The user gets
cache. If the cache is stale enough (past `staleTime`), the next
read refreshes. This is the discipline that ended the 429 storm of
the early phases. Don't reintroduce focus-refetching.

`refetchOnReconnect: true` is debounced by
`lib/session-watchdog.ts` so a wake-from-sleep `online` burst fires
exactly one refetch wave, not twenty.

## 6. Polling is per-query and rare

Default: no polling. Per-query opt-in is allowed for genuinely live
surfaces:

- `/platform/operations` has `refetchInterval: 15_000` on the health
  section.
- `notifications-inbox` polls every 30s for unread count.

**Forbidden**: a global `refetchInterval` default. Setting one
recreates the 429 storm at a larger scale.

If you're tempted to poll, ask: would a `LIVE_OPERATOR` staleTime +
a manual Refresh button do the job? It usually does.

## 7. Mutations + invalidation order

Pattern for write paths:

```ts
const mutation = useMutation({
  mutationFn: () => studentsApi.archive(id, reason),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['students'] });
    // Optionally optimistic update; otherwise the refetch covers it.
  },
});
```

Rules:

- **`onSuccess` invalidates.** Don't invalidate before the mutation
  resolves; the user sees stale-or-flashing state.
- **Mutations don't auto-retry.** `lib/query-client.ts` sets
  `mutations: { retry: 0 }`. A duplicate write is worse than a
  single visible failure.
- **`onError` should surface a toast with remediation**, see
  `FAILURE_HANDLING_GUIDELINES.md`.

## 8. Auth-gating is non-optional

Every protected query MUST gate on `useAuthReady()`:

```ts
const { authReady, isAuthenticated } = useAuthReady();
return useQuery({
  queryKey: qk.students(filter),
  queryFn: () => studentsApi.list(filter),
  enabled: authReady && isAuthenticated,
});
```

Without this gate, queries fire during the bootstrap window with no
JWT in `localStorage` yet → 401s → the global 401 redirect kicks in
→ the user lands on `/login` from what looked like a logged-in
state. This was a real bug; the gate is the fix.

## 9. The reference-data anti-pattern

Reference data (classes, subjects, sessions) is fetched ONCE per
tab. If you see a query for reference data fired during a mutation
flow, you're doing it wrong:

```ts
// ❌ Bad — refetches classes after every save
const { data: classes } = useClasses();
const handleSave = async () => {
  await api.save(...);
  qc.invalidateQueries({ queryKey: qk.classes() }); // ← unnecessary
};

// ✅ Good — classes are stable. Don't invalidate them after a student
// save; the only thing that should invalidate classes is a class
// CRUD operation.
```

Rule of thumb: **invalidate ONLY the resource you mutated.** A
student edit invalidates students, not classes. The
RequestPressurePanel reference-data duplicate detector exists
precisely to catch violations of this rule.

## 10. PR review checklist for cache changes

- [ ] Every new `useQuery` has a named `staleTime` tier.
- [ ] Query key goes through `qk.*` helper.
- [ ] Auth gate `enabled: authReady && isAuthenticated` is present.
- [ ] No `invalidateQueries({})` call anywhere.
- [ ] Invalidation key is the narrowest that covers the change.
- [ ] No new `useEffect(() => fetch().then(setState))` patterns.
- [ ] If polling, the per-query `refetchInterval` is justified in a
      comment.
- [ ] RequestPressurePanel chip remains green after the change.

Tick every box, or write down why one doesn't apply.
