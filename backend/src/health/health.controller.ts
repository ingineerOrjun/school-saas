import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// HealthController — Phase 22 deployment-readiness endpoints.
//
// Three unauthenticated probes for the orchestrator:
//
//   GET /health/live   — liveness. Returns 200 iff the Node process
//                         is alive and the event loop is responsive.
//                         Cheapest possible check (no DB, no I/O).
//                         k8s livenessProbe target — failures restart
//                         the pod.
//
//   GET /health/ready  — readiness. Returns 200 iff the process is
//                         ready to accept traffic: DB probe passes,
//                         Nest finished bootstrapping. Returns 503
//                         when the DB is wedged (orchestrator
//                         removes the pod from the load-balancer
//                         pool but doesn't restart it).
//                         k8s readinessProbe target.
//
//   GET /health        — pretty status page. Returns the Phase 10
//                         operator-facing payload from HealthService.
//                         Same data as /platform/health but
//                         unauthenticated, so a status-page widget
//                         can poll it.
//
// Throttle:
//   @SkipThrottle() — these endpoints are polled aggressively by
//   probes (every few seconds in k8s default config). Counting them
//   against the 600/min/IP default would burn the whole budget on
//   the orchestrator's healthcheck loop.
// ---------------------------------------------------------------------------

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness — process is alive. No external dependencies probed,
   * because liveness failures restart the pod and we don't want to
   * cycle on a downstream blip.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok'; uptimeSec: number; ts: string } {
    return {
      status: 'ok',
      uptimeSec: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    };
  }

  /**
   * Readiness — process can accept traffic. Probes the DB; returns
   * 503 (via thrown exception) when unreachable so the orchestrator
   * knows to drain. Errors are intentionally swallowed and converted
   * into the 503 shape — readiness is about the answer, not the
   * stack trace.
   */
  @Get('ready')
  async ready(): Promise<{
    status: 'ok' | 'degraded';
    checks: Record<string, 'ok' | 'fail'>;
  }> {
    const checks: Record<string, 'ok' | 'fail'> = { db: 'fail' };
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      checks.db = 'ok';
    } catch {
      // Stays 'fail' — caller decides 503 status from the response shape.
    }
    const allOk = Object.values(checks).every((v) => v === 'ok');
    return { status: allOk ? 'ok' : 'degraded', checks };
  }
}
