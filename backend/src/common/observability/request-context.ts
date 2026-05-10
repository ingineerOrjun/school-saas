import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// RequestContext — AsyncLocalStorage-backed correlation propagation.
//
// Every HTTP request gets a unique correlation id (the inbound
// `x-request-id` header is honoured if present; otherwise a UUID is
// generated). The middleware seeds the context for the request's
// lifetime; downstream code reads `RequestContext.current()` to get:
//
//   • requestId — surfaces in every log line + audit row + job row
//                 + notification row created during the request
//   • userId    — once auth has run; null on unauthenticated routes
//   • schoolId  — when the request is tenant-scoped
//   • route     — matched Express path (helps log searches)
//
// The contract is:
//
//   middleware → run(initialContext, async () => { rest of request })
//
// Anything inside that callback (controllers, services, handlers,
// awaited async work, even setTimeout-fired callbacks) sees the
// same context via `current()`. Two parallel requests have isolated
// contexts — that's the whole point of AsyncLocalStorage.
//
// Why not Nest's CLS module:
//   • One file, zero deps, no DI surface.
//   • Same primitive — `nestjs-cls` is a thin wrapper over this.
//   • Keeps the call-site API minimal: a single static read.
//
// Cost: AsyncLocalStorage adds ~200ns per await per request. Negligible
// vs the signal it produces.
// ---------------------------------------------------------------------------

export interface RequestContextValue {
  /** UUID — `x-request-id` inbound, or generated. */
  requestId: string;
  /** Authenticated user id when known. Set by JwtStrategy. */
  userId: string | null;
  /** Tenant id when the request is scoped to one. */
  schoolId: string | null;
  /** Matched Express route ("/students/:id"). Set by middleware on finish. */
  route: string | null;
  /** HTTP method. */
  method: string | null;
  /** ISO timestamp the request started — for duration calcs. */
  startedAt: string;
}

const als = new AsyncLocalStorage<RequestContextValue>();

export const RequestContext = {
  /**
   * Run `fn` with the supplied context active. Anything awaited inside
   * `fn` (and any callbacks it schedules) sees the same context via
   * `current()`. Used by the request middleware to seed each request.
   */
  run<T>(initial: Partial<RequestContextValue>, fn: () => T): T {
    const value: RequestContextValue = {
      requestId: initial.requestId ?? randomUUID(),
      userId: initial.userId ?? null,
      schoolId: initial.schoolId ?? null,
      route: initial.route ?? null,
      method: initial.method ?? null,
      startedAt: initial.startedAt ?? new Date().toISOString(),
    };
    return als.run(value, fn);
  },

  /**
   * Get the active context. Returns null when called outside a
   * request (e.g. boot-time work, cron firing). Callers MUST handle
   * the null case — adding "x-request-id: cron" or similar is the
   * caller's job, not this primitive's.
   */
  current(): RequestContextValue | null {
    return als.getStore() ?? null;
  },

  /**
   * Mutate the active context. Used by JwtStrategy (to stamp userId
   * / schoolId after auth resolves) and by the metrics middleware
   * (to record the matched route on `finish`). No-op when called
   * outside a request.
   */
  set<K extends keyof RequestContextValue>(
    key: K,
    value: RequestContextValue[K],
  ): void {
    const ctx = als.getStore();
    if (!ctx) return;
    ctx[key] = value;
  },

  /** Convenience getter — `requestId` only. Returns null when no context. */
  requestId(): string | null {
    return als.getStore()?.requestId ?? null;
  },
};
