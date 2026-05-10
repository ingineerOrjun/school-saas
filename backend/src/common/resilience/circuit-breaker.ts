// ---------------------------------------------------------------------------
// CircuitBreaker — Phase 22.
//
// Generic in-memory circuit breaker for fragile downstream
// integrations (email provider today; SMS / payment gateways when
// they land). Three states:
//
//   CLOSED   — calls pass through. Failures count toward the trip
//              threshold.
//   OPEN     — calls reject immediately ("fast-fail"). After
//              `resetAfterMs` ms, the breaker transitions to
//              HALF_OPEN and lets one probe through.
//   HALF_OPEN — exactly one in-flight call; success → CLOSED,
//              failure → OPEN.
//
// Why no Redis / shared state:
//   Per-process state is the right shape until the platform scales
//   horizontally. Each Node instance independently observes its
//   own failure rate against the provider — if the provider is
//   genuinely down, every instance trips quickly. A future
//   distributed coordination (Redis, etcd) only matters if some
//   instances see a healthy provider while others see a broken one,
//   which is rare.
//
// State observability:
//   `snapshot()` returns the current state + counters so the
//   Operations Center subsystem card can show "EMAIL — OPEN
//   (cooldown 23s)". The breaker doesn't log on its own; the
//   wrapping service decides what to surface.
//
// Cost:
//   One Date.now() + a counter increment per call. Negligible vs
//   the IO it gates.
// ---------------------------------------------------------------------------

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Human-readable name for logs / Operations Center display. */
  name: string;
  /** Trip threshold — N consecutive failures (NOT total). */
  failureThreshold: number;
  /** Time the breaker stays OPEN before HALF_OPEN. */
  resetAfterMs: number;
  /**
   * Successes required in HALF_OPEN before returning to CLOSED.
   * 1 is conservative (one probe → closed); higher values smooth
   * recovery on flaky providers.
   */
  halfOpenSuccessesToClose?: number;
}

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  /** Consecutive failures (in CLOSED) or HALF_OPEN failures since open. */
  failures: number;
  /** Successes since the last state transition. */
  successes: number;
  /** ISO timestamp of the most recent state change. */
  lastTransitionAt: string;
  /** When the breaker can next transition to HALF_OPEN (ISO). Null in non-OPEN states. */
  nextHalfOpenAt: string | null;
  /** Total successful calls since process start. */
  totalSuccess: number;
  /** Total failed calls since process start. */
  totalFailure: number;
  /** Calls rejected by the breaker without contacting the upstream. */
  totalShortCircuited: number;
}

/**
 * Error thrown when a call is rejected by an OPEN breaker. Lets
 * upstream callers tell "the upstream said no" from "we didn't
 * even ask the upstream because it's down."
 */
export class CircuitOpenError extends Error {
  constructor(public readonly breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN — call rejected.`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private totalSuccess = 0;
  private totalFailure = 0;
  private totalShortCircuited = 0;
  private lastTransitionAt = Date.now();
  private nextHalfOpenAt: number | null = null;
  private halfOpenInFlight = false;
  private readonly halfOpenSuccessesToClose: number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.halfOpenSuccessesToClose = opts.halfOpenSuccessesToClose ?? 1;
  }

  /**
   * Run `fn` through the breaker. Throws CircuitOpenError when the
   * breaker rejects without trying. Re-throws upstream errors as-is
   * so callers can branch on the underlying cause.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      this.totalShortCircuited += 1;
      throw new CircuitOpenError(this.opts.name);
    }

    if (this.state === 'HALF_OPEN') {
      // Only one probe at a time in HALF_OPEN — others fast-fail.
      if (this.halfOpenInFlight) {
        this.totalShortCircuited += 1;
        throw new CircuitOpenError(this.opts.name);
      }
      this.halfOpenInFlight = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure();
      throw e;
    } finally {
      if (this.state === 'HALF_OPEN' || (this.state as string) === 'OPEN') {
        this.halfOpenInFlight = false;
      }
    }
  }

  /** Read-only snapshot for the Operations Center. */
  snapshot(): CircuitSnapshot {
    this.maybeTransitionToHalfOpen();
    return {
      name: this.opts.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastTransitionAt: new Date(this.lastTransitionAt).toISOString(),
      nextHalfOpenAt:
        this.nextHalfOpenAt !== null
          ? new Date(this.nextHalfOpenAt).toISOString()
          : null,
      totalSuccess: this.totalSuccess,
      totalFailure: this.totalFailure,
      totalShortCircuited: this.totalShortCircuited,
    };
  }

  /**
   * Operator override — force the breaker back to CLOSED. Useful
   * when ops manually verified the provider is healthy and don't
   * want to wait for the cooldown. Resets failure counters but
   * preserves the lifetime totals.
   */
  forceClose(): void {
    this.transition('CLOSED');
  }

  // -------------------------------------------------------------------------
  // Internal state machine
  // -------------------------------------------------------------------------

  private onSuccess(): void {
    this.totalSuccess += 1;
    if (this.state === 'CLOSED') {
      // Reset the consecutive-failure counter — one success means
      // the run of failures ended.
      this.failures = 0;
      return;
    }
    if (this.state === 'HALF_OPEN') {
      this.successes += 1;
      if (this.successes >= this.halfOpenSuccessesToClose) {
        this.transition('CLOSED');
      }
    }
  }

  private onFailure(): void {
    this.totalFailure += 1;
    if (this.state === 'HALF_OPEN') {
      this.transition('OPEN');
      return;
    }
    if (this.state === 'CLOSED') {
      this.failures += 1;
      if (this.failures >= this.opts.failureThreshold) {
        this.transition('OPEN');
      }
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === 'OPEN' &&
      this.nextHalfOpenAt !== null &&
      Date.now() >= this.nextHalfOpenAt
    ) {
      this.transition('HALF_OPEN');
    }
  }

  private transition(next: CircuitState): void {
    this.state = next;
    this.lastTransitionAt = Date.now();
    this.failures = 0;
    this.successes = 0;
    this.halfOpenInFlight = false;
    this.nextHalfOpenAt =
      next === 'OPEN' ? Date.now() + this.opts.resetAfterMs : null;
  }
}
