import { HealthService } from './health.service';
import type { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// HealthService — Phase 11 maturity tests.
//
// Focused on the contract the platform health dashboard depends on:
//   • Time-windowed counts (5/15/60 min) for the error + login-failure
//     ring buffers.
//   • Status rollup logic (green / yellow / red) per the spec.
//   • DB probe healthy/unhealthy outcomes are reflected in the payload.
//   • Buffers are bounded — pushing beyond ERROR_BUFFER_SIZE drops
//     the oldest, never grows unbounded.
//
// We don't mock `process.memoryUsage` — the real values are fine for
// the assertion ("memory keys are present, RSS is positive").
// ---------------------------------------------------------------------------

function buildHarness(opts: { dbHealthy?: boolean; dbErrorMessage?: string } = {}) {
  const { dbHealthy = true, dbErrorMessage } = opts;
  // Keep the mock loose with `any` — Prisma's $queryRawUnsafe returns
  // a PrismaPromise<T>, not a plain Promise; the contract under test
  // is simply "throws on unhealthy, resolves on healthy."
  const prisma = {
    $queryRawUnsafe: jest.fn(async () => {
      if (!dbHealthy) {
        throw new Error(dbErrorMessage ?? 'DB probe failed');
      }
      return [{ ok: 1 }];
    }),
  } as unknown as PrismaService;
  const service = new HealthService(prisma);
  return { service };
}

describe('HealthService', () => {
  describe('uptime', () => {
    it('reports uptime since construction (positive seconds + a pretty string)', async () => {
      const h = buildHarness();
      // Wait briefly so seconds is at least 0 (instant).
      const result = await h.service.getHealth();
      expect(result.uptime.seconds).toBeGreaterThanOrEqual(0);
      expect(typeof result.uptime.pretty).toBe('string');
      expect(result.uptime.pretty.length).toBeGreaterThan(0);
      expect(typeof result.uptime.startedAt).toBe('string');
    });
  });

  describe('memory', () => {
    it('returns RSS / heap stats with positive values', async () => {
      const h = buildHarness();
      const result = await h.service.getHealth();
      expect(result.memory.rssMb).toBeGreaterThan(0);
      expect(result.memory.heapTotalMb).toBeGreaterThan(0);
      // Heap used is always <= heap total.
      expect(result.memory.heapUsedMb).toBeLessThanOrEqual(
        result.memory.heapTotalMb,
      );
    });
  });

  describe('database probe', () => {
    it('reports healthy with a positive latency when SELECT 1 succeeds', async () => {
      const h = buildHarness({ dbHealthy: true });
      const result = await h.service.getHealth();
      expect(result.database.healthy).toBe(true);
      expect(result.database.latencyMs).not.toBeNull();
      expect(result.database.latencyMs!).toBeGreaterThanOrEqual(0);
      expect(result.database.error).toBeNull();
    });

    it('reports unhealthy when the probe throws, surfacing the error', async () => {
      const h = buildHarness({
        dbHealthy: false,
        dbErrorMessage: 'connection refused',
      });
      const result = await h.service.getHealth();
      expect(result.database.healthy).toBe(false);
      expect(result.database.latencyMs).toBeNull();
      expect(result.database.error).toContain('connection refused');
    });
  });

  describe('error ring buffer windowing', () => {
    it('counts events within 5/15/60 minute windows separately', async () => {
      const h = buildHarness();
      const now = Date.now();

      // Spread 3 events across the windows by mutating their `at`
      // timestamps after recording.
      h.service.recordError({ status: 500, method: 'GET', route: '/x', message: 'a' });
      h.service.recordError({ status: 500, method: 'GET', route: '/x', message: 'b' });
      h.service.recordError({ status: 500, method: 'GET', route: '/x', message: 'c' });

      const buf = (h.service as unknown as { errors: Array<{ at: string }> })
        .errors;
      buf[0].at = new Date(now - 1 * 60_000).toISOString();   // 1 min ago
      buf[1].at = new Date(now - 10 * 60_000).toISOString();  // 10 min ago
      buf[2].at = new Date(now - 50 * 60_000).toISOString();  // 50 min ago

      const result = await h.service.getHealth();
      expect(result.errors.last5min).toBe(1);
      expect(result.errors.last15min).toBe(2);
      expect(result.errors.last60min).toBe(3);
      expect(result.errors.totalSinceStart).toBe(3);
    });

    it('records the most recent event first in `recent`', async () => {
      const h = buildHarness();
      h.service.recordError({ status: 500, method: 'GET', route: '/a', message: 'first' });
      h.service.recordError({ status: 500, method: 'GET', route: '/b', message: 'second' });
      const result = await h.service.getHealth();
      expect(result.errors.recent[0].route).toBe('/b');
      expect(result.errors.recent[1].route).toBe('/a');
    });

    it('caps the buffer — pushing more than 200 entries drops the oldest', async () => {
      const h = buildHarness();
      for (let i = 0; i < 250; i++) {
        h.service.recordError({
          status: 500,
          method: 'GET',
          route: `/r${i}`,
          message: `err ${i}`,
        });
      }
      const buf = (h.service as unknown as { errors: unknown[] }).errors;
      expect(buf.length).toBe(200);
      // totalSinceStart still records every push.
      const result = await h.service.getHealth();
      expect(result.errors.totalSinceStart).toBe(250);
    });
  });

  describe('login failure ring buffer + top IPs', () => {
    it('returns top source IPs in the last 60 minutes, descending', async () => {
      const h = buildHarness();
      h.service.recordLoginFailure({ email: 'a', ip: '10.0.0.1', reason: 'invalid_credentials' });
      h.service.recordLoginFailure({ email: 'b', ip: '10.0.0.1', reason: 'invalid_credentials' });
      h.service.recordLoginFailure({ email: 'c', ip: '10.0.0.2', reason: 'invalid_credentials' });
      h.service.recordLoginFailure({ email: 'd', ip: '10.0.0.1', reason: 'invalid_credentials' });

      const result = await h.service.getHealth();
      expect(result.loginFailures.topIps).toHaveLength(2);
      expect(result.loginFailures.topIps[0]).toEqual({
        ip: '10.0.0.1',
        count: 3,
      });
      expect(result.loginFailures.topIps[1]).toEqual({
        ip: '10.0.0.2',
        count: 1,
      });
    });

    it('coerces a missing IP to <unknown> in the rollup', async () => {
      const h = buildHarness();
      h.service.recordLoginFailure({
        email: 'a',
        ip: null,
        reason: 'invalid_credentials',
      });
      const result = await h.service.getHealth();
      expect(result.loginFailures.topIps[0]).toEqual({
        ip: '<unknown>',
        count: 1,
      });
    });
  });

  describe('status rollup', () => {
    it('returns "green" when DB is healthy and counts are quiet', async () => {
      const h = buildHarness({ dbHealthy: true });
      const result = await h.service.getHealth();
      expect(result.status).toBe('green');
    });

    it('returns "red" when the DB probe fails', async () => {
      const h = buildHarness({ dbHealthy: false });
      const result = await h.service.getHealth();
      expect(result.status).toBe('red');
    });

    it('returns "yellow" when error rate exceeds the threshold (>50/hr)', async () => {
      const h = buildHarness({ dbHealthy: true });
      const now = Date.now();
      // 51 errors all within 60min.
      for (let i = 0; i < 51; i++) {
        h.service.recordError({
          status: 500,
          method: 'GET',
          route: `/r${i}`,
          message: 'x',
        });
      }
      const buf = (h.service as unknown as { errors: Array<{ at: string }> })
        .errors;
      for (const r of buf) r.at = new Date(now - 30 * 60_000).toISOString();
      const result = await h.service.getHealth();
      expect(result.status).toBe('yellow');
    });

    it('returns "yellow" when login failures exceed the threshold (>100/hr)', async () => {
      const h = buildHarness({ dbHealthy: true });
      const now = Date.now();
      for (let i = 0; i < 101; i++) {
        h.service.recordLoginFailure({
          email: `u${i}@x`,
          ip: '10.0.0.1',
          reason: 'invalid_credentials',
        });
      }
      const buf = (
        h.service as unknown as { loginFailures: Array<{ at: string }> }
      ).loginFailures;
      for (const r of buf) r.at = new Date(now - 30 * 60_000).toISOString();
      const result = await h.service.getHealth();
      expect(result.status).toBe('yellow');
    });

    it('red beats yellow when both conditions trip', async () => {
      const h = buildHarness({ dbHealthy: false });
      for (let i = 0; i < 60; i++) {
        h.service.recordError({
          status: 500,
          method: 'GET',
          route: '/r',
          message: 'x',
        });
      }
      const result = await h.service.getHealth();
      expect(result.status).toBe('red');
    });
  });
});
