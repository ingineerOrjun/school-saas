import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';
import { RequestContext } from './request-context';

// ---------------------------------------------------------------------------
// RequestMetricsMiddleware — observability for the "which component is
// spamming?" / "what's slow?" / "who's getting throttled?" questions.
//
// Captures per-request:
//   • method + route (the matched Express path, not the full URL,
//     so /students/:id collapses to one bucket)
//   • user id (when authenticated; falls back to anonymous)
//   • duration in ms
//   • status code
//   • throttled? (true when status === 429)
//   • timestamp (ms since epoch)
//
// Three outputs:
//
//   1. STDOUT line per slow / throttled / error request — for ops
//      tailing logs during incident triage.
//   2. Lifetime rollup (Map<routeKey, EndpointStats>) — counters
//      since process start; backs the legacy "top endpoints" UI.
//   3. Time-windowed RING BUFFER (last N samples) — backs the
//      Operations Center's request-monitoring section. Lets us
//      compute "top endpoints in the last 15m / 1h / 24h" with
//      p95 latency, throttle counts, and an RPM time series
//      WITHOUT a database write per request.
//
// Why middleware (not interceptor):
//   • Middleware sees the request BEFORE Nest's pipes/guards run,
//     and the response AFTER everything settles. We get accurate
//     duration including guard cost.
//   • Interceptors can't see the response status easily for the
//     RxJS error path; middleware reads `res.statusCode` after
//     `res.on('finish')`.
//
// Memory budget: SAMPLE_BUFFER_SIZE × ~80 bytes/sample ≈ 1.6MB at
// 20K samples. At 600 req/min (the global default bucket), that's
// ~33 minutes of full history; the windowed methods downsample
// further. At sustained higher rates the oldest samples drop
// first — bounded memory is the contract.
// ---------------------------------------------------------------------------

const SAMPLE_BUFFER_SIZE = 20_000;

interface EndpointStats {
  count: number;
  totalDurationMs: number;
  errors4xx: number;
  errors5xx: number;
  throttled: number;
}

interface RequestSample {
  /** ms since epoch — monotonic for our purposes (process clock). */
  t: number;
  routeKey: string;
  durationMs: number;
  status: number;
  userId: string | null;
  /** Best-effort source IP (snapshot at request time). */
  ip: string | null;
}

export interface EndpointWindowStat {
  routeKey: string;
  count: number;
  avgDurationMs: number;
  p95DurationMs: number;
  errors4xx: number;
  errors5xx: number;
  throttled: number;
}

export interface RpmBucket {
  /** ISO timestamp of the bucket start. */
  at: string;
  count: number;
  errors: number;
  throttled: number;
}

@Injectable()
export class RequestMetricsService {
  /** Lifetime rollup — route → stats. The route key is `${method} ${path}`. */
  private readonly stats = new Map<string, EndpointStats>();
  /** Lifetime — user → 429 count. Survives the windowed buffer. */
  private readonly throttledByUser = new Map<string, number>();
  /** Lifetime — IP → 429 count. Phase 22 abuse-detection panel. */
  private readonly throttledByIp = new Map<string, number>();
  /** Lifetime — routeKey → 429 count. Same panel. */
  private readonly throttledByRoute = new Map<string, number>();

  /**
   * Bounded ring of recent samples. Newest at the END (push) so we
   * can `slice(-N)` cheaply for window queries; samples older than
   * any window we care about (24h) are pruned by displacement, not
   * timer — overhead-free.
   */
  private readonly samples: RequestSample[] = [];

  record(input: {
    routeKey: string;
    durationMs: number;
    status: number;
    userId: string | null;
    ip: string | null;
  }): void {
    // Lifetime rollup.
    const s = this.stats.get(input.routeKey) ?? {
      count: 0,
      totalDurationMs: 0,
      errors4xx: 0,
      errors5xx: 0,
      throttled: 0,
    };
    s.count += 1;
    s.totalDurationMs += input.durationMs;
    if (input.status >= 500) s.errors5xx += 1;
    else if (input.status >= 400) s.errors4xx += 1;
    if (input.status === 429) {
      s.throttled += 1;
      const userKey = input.userId ?? '<anon>';
      this.throttledByUser.set(
        userKey,
        (this.throttledByUser.get(userKey) ?? 0) + 1,
      );
      const ipKey = input.ip ?? '<unknown>';
      this.throttledByIp.set(
        ipKey,
        (this.throttledByIp.get(ipKey) ?? 0) + 1,
      );
      this.throttledByRoute.set(
        input.routeKey,
        (this.throttledByRoute.get(input.routeKey) ?? 0) + 1,
      );
    }
    this.stats.set(input.routeKey, s);

    // Ring buffer.
    this.samples.push({
      t: Date.now(),
      routeKey: input.routeKey,
      durationMs: input.durationMs,
      status: input.status,
      userId: input.userId,
      ip: input.ip,
    });
    if (this.samples.length > SAMPLE_BUFFER_SIZE) {
      // Drop the oldest. shift() is O(n); when this fires we're at
      // the cap, so the constant work amortises across requests.
      this.samples.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Lifetime queries (legacy) — kept for the existing widgets.
  // ---------------------------------------------------------------------------

  topEndpoints(n = 20) {
    return [...this.stats.entries()]
      .map(([route, s]) => ({
        route,
        count: s.count,
        avgDurationMs: s.count > 0 ? s.totalDurationMs / s.count : 0,
        errors4xx: s.errors4xx,
        errors5xx: s.errors5xx,
        throttled: s.throttled,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  topThrottledUsers(n = 10) {
    return [...this.throttledByUser.entries()]
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /** Phase 22 — top throttled IPs. Backs the abuse-detection panel. */
  topThrottledIps(n = 10) {
    return [...this.throttledByIp.entries()]
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /** Phase 22 — endpoints causing the most 429s. */
  topThrottledRoutes(n = 10) {
    return [...this.throttledByRoute.entries()]
      .map(([routeKey, count]) => ({ routeKey, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /** Operator reset (when investigating a fresh incident). */
  reset(): void {
    this.stats.clear();
    this.throttledByUser.clear();
    this.throttledByIp.clear();
    this.throttledByRoute.clear();
    this.samples.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Time-windowed queries (Operations Center).
  //
  // All windowed queries share the same scan over `samples`. We
  // walk newest-first and break early once we cross the cutoff
  // — the buffer is push-ordered, so this is O(window-size), not
  // O(buffer-size).
  // ---------------------------------------------------------------------------

  /** Total samples in the last `windowMs` ms. */
  countInWindow(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    let n = 0;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].t < cutoff) break;
      n += 1;
    }
    return n;
  }

  /**
   * Requests-per-minute over the last minute. Used by the live KPI
   * row. Uses the 60s window; cheap because it scans at most
   * ~600 samples (the default bucket cap × 1 min).
   */
  currentRpm(): number {
    return this.countInWindow(60_000);
  }

  /**
   * Top endpoints in the window, sorted by `sortBy`.
   *
   *   "volume"   — most-called
   *   "latency"  — slowest by p95
   *   "errors"   — most 5xx
   *   "throttled"— most 429
   *
   * `n` clips the list. Each row carries the same shape so the UI
   * can render any of these in the same table component.
   */
  topByWindow(input: {
    windowMs: number;
    sortBy: 'volume' | 'latency' | 'errors' | 'throttled';
    n?: number;
  }): EndpointWindowStat[] {
    const cutoff = Date.now() - input.windowMs;

    // Group durations per route (we need the full latency vector
    // for p95, so we materialize). Buckets are bounded by the
    // window count, not the buffer size.
    const durations = new Map<string, number[]>();
    const errors4xx = new Map<string, number>();
    const errors5xx = new Map<string, number>();
    const throttled = new Map<string, number>();

    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s.t < cutoff) break;
      const arr = durations.get(s.routeKey);
      if (arr) arr.push(s.durationMs);
      else durations.set(s.routeKey, [s.durationMs]);
      if (s.status === 429) {
        throttled.set(s.routeKey, (throttled.get(s.routeKey) ?? 0) + 1);
      } else if (s.status >= 500) {
        errors5xx.set(s.routeKey, (errors5xx.get(s.routeKey) ?? 0) + 1);
      } else if (s.status >= 400) {
        errors4xx.set(s.routeKey, (errors4xx.get(s.routeKey) ?? 0) + 1);
      }
    }

    const rows: EndpointWindowStat[] = [];
    for (const [routeKey, arr] of durations.entries()) {
      arr.sort((a, b) => a - b);
      const sum = arr.reduce((s, x) => s + x, 0);
      rows.push({
        routeKey,
        count: arr.length,
        avgDurationMs: arr.length > 0 ? sum / arr.length : 0,
        p95DurationMs: percentile(arr, 0.95),
        errors4xx: errors4xx.get(routeKey) ?? 0,
        errors5xx: errors5xx.get(routeKey) ?? 0,
        throttled: throttled.get(routeKey) ?? 0,
      });
    }

    rows.sort((a, b) => {
      switch (input.sortBy) {
        case 'volume':
          return b.count - a.count;
        case 'latency':
          return b.p95DurationMs - a.p95DurationMs;
        case 'errors':
          return b.errors5xx - a.errors5xx || b.errors4xx - a.errors4xx;
        case 'throttled':
          return b.throttled - a.throttled;
      }
    });
    return rows.slice(0, input.n ?? 10);
  }

  /**
   * Bucketed RPM time series across the window. Returns
   * `windowMs / bucketMs` rows oldest-first — direct shape for
   * the request-volume chart. Fills empty buckets with zeros so
   * the chart renders with a continuous x-axis.
   */
  rpmSeries(input: { windowMs: number; bucketMs: number }): RpmBucket[] {
    const now = Date.now();
    const start = now - input.windowMs;
    const bucketCount = Math.ceil(input.windowMs / input.bucketMs);
    const buckets: RpmBucket[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const at = start + i * input.bucketMs;
      buckets.push({
        at: new Date(at).toISOString(),
        count: 0,
        errors: 0,
        throttled: 0,
      });
    }
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s.t < start) break;
      const idx = Math.min(
        Math.floor((s.t - start) / input.bucketMs),
        bucketCount - 1,
      );
      const b = buckets[idx];
      b.count += 1;
      if (s.status === 429) b.throttled += 1;
      else if (s.status >= 500) b.errors += 1;
    }
    return buckets;
  }

  /**
   * Window summary — used by the live overview KPIs. All five
   * metrics from one scan so we don't iterate the buffer multiple
   * times per dashboard refresh.
   */
  windowSummary(windowMs: number): {
    requests: number;
    errors: number;
    throttled: number;
    avgDurationMs: number;
    errorRatePct: number;
  } {
    const cutoff = Date.now() - windowMs;
    let requests = 0;
    let errors = 0;
    let throttled = 0;
    let totalDuration = 0;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s.t < cutoff) break;
      requests += 1;
      totalDuration += s.durationMs;
      if (s.status === 429) throttled += 1;
      else if (s.status >= 500) errors += 1;
    }
    return {
      requests,
      errors,
      throttled,
      avgDurationMs: requests > 0 ? totalDuration / requests : 0,
      errorRatePct: requests > 0 ? (errors / requests) * 100 : 0,
    };
  }
}

@Injectable()
export class RequestMetricsMiddleware implements NestMiddleware {
  private readonly logger = new Logger('RequestMetrics');

  constructor(private readonly metrics: RequestMetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startNs = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startNs) / 1_000_000;
      // Express resolves `req.route?.path` AFTER the matched route
      // runs, so the matched path (e.g. `/students/:id`) is available
      // here. Falls back to the raw URL when no route matched
      // (e.g. 404 — useful signal too).
      const route = req.route?.path ?? req.path ?? req.url;
      const routeKey = `${req.method} ${route}`;
      const status = res.statusCode;
      const user = (req as Request & { user?: AuthenticatedUser }).user;
      const userId = user?.id ?? null;
      const ip = req.ip ?? null;

      // Stamp the matched route + auth-derived ids onto the request
      // context so the JSON logger can include them on the boundary
      // log line. Set is a no-op if no context is active.
      RequestContext.set('route', routeKey);
      if (userId) RequestContext.set('userId', userId);
      if (user?.schoolId) RequestContext.set('schoolId', user.schoolId);

      this.metrics.record({ routeKey, durationMs, status, userId, ip });

      // Conditional log lines — keep stdout quiet on healthy
      // requests, loud on the cases the operator cares about.
      if (status === 429) {
        // Diagnostic — include the throttler's chosen tracker
        // (stamped onto req by UserAwareThrottlerGuard) so we know
        // whether the throttle keyed per-user or per-IP. This is
        // the source of truth, vs `userId` which only reflects
        // what Passport populated AFTER the throttler ran.
        const referer = req.headers.referer ?? '<none>';
        const hasAuth = !!req.headers.authorization;
        const tracker =
          (req as Request & { _throttleTracker?: string })
            ._throttleTracker ?? '<unset>';
        this.logger.warn(
          `[throttled] ${routeKey} user=${userId ?? '<anon>'} ` +
            `tracker=${tracker} ` +
            `auth=${hasAuth ? 'present' : 'missing'} ` +
            `referer=${referer} ${durationMs.toFixed(0)}ms`,
        );
      } else if (status >= 500) {
        this.logger.error(
          `[5xx] ${routeKey} user=${userId ?? '<anon>'} ` +
            `status=${status} ${durationMs.toFixed(0)}ms`,
        );
      } else if (durationMs > 1_000) {
        this.logger.warn(
          `[slow] ${routeKey} user=${userId ?? '<anon>'} ` +
            `${durationMs.toFixed(0)}ms`,
        );
      }
    });

    next();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Linear-interpolated percentile. `arr` must be sorted ascending.
 * Returns 0 for empty input. Used for p95 latency reporting; a
 * "good enough" implementation — fancy quantile sketches are
 * overkill for an in-memory ring buffer.
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
}
