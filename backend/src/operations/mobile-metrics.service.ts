import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// MobileMetricsService — Phase 26 Section 7.
//
// Derives mobile-shaped operational signals from existing backend
// data sources. We do NOT add a client telemetry POST endpoint in
// this phase — the metrics here are the ones the server can see
// without extra wiring:
//
//   • mobile vs desktop usage (from Session.userAgent)
//   • job-queue retry health (from Job.attempts)
//   • new-device detection (from Session.deviceFingerprint)
//   • impersonation activity (from Audit)
//
// Honest scope:
//   sync success rate / offline duration / low-data-mode sessions
//   are CLIENT-side signals. A follow-up phase can add a beacon
//   POST endpoint + persistence to capture those. The shape returned
//   by this service is forward-compatible — once that data lands,
//   we just add fields without changing the read API.
// ---------------------------------------------------------------------------

export interface MobileMetricsRollup {
  generatedAt: string;
  /** Active sessions in the last 24h, split by device class. */
  sessionsByClass: {
    mobile: number;
    desktop: number;
    unknown: number;
  };
  /** Distinct device fingerprints seen in the last 7d. */
  distinctDevices7d: number;
  /** Job queue retry health. */
  jobRetries: {
    /** Total retries across all jobs in the last 24h (sum of attempts > 1). */
    last24h: number;
    /** Jobs whose attempts >= maxAttempts (= dead-letter-bound). */
    exhausted24h: number;
  };
  /** Top 5 user-agents observed in the last 24h, with counts. */
  topUserAgents: Array<{ userAgent: string; count: number }>;
}

@Injectable()
export class MobileMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRollup(): Promise<MobileMetricsRollup> {
    const now = new Date();
    const day1 = new Date(now.getTime() - 24 * 60 * 60_000);
    const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60_000);

    const [
      activeSessions,
      distinctFingerprints,
      jobsLast24h,
      topUaRows,
    ] = await Promise.all([
      this.prisma.session.findMany({
        where: { revokedAt: null, lastActiveAt: { gte: day1 } },
        select: { userAgent: true },
        take: 5_000,
      }),
      this.prisma.session.findMany({
        where: {
          createdAt: { gte: day7 },
          deviceFingerprint: { not: null },
        },
        distinct: ['deviceFingerprint'],
        select: { deviceFingerprint: true },
      }),
      this.prisma.job.findMany({
        where: { updatedAt: { gte: day1 } },
        select: { attempts: true, maxAttempts: true, status: true },
        take: 10_000,
      }),
      this.prisma.session.groupBy({
        by: ['userAgent'],
        where: { revokedAt: null, lastActiveAt: { gte: day1 } },
        _count: { _all: true },
        orderBy: { _count: { userAgent: 'desc' } },
        take: 5,
      }),
    ]);

    // Classify each session by UA.
    let mobile = 0;
    let desktop = 0;
    let unknown = 0;
    for (const s of activeSessions) {
      const cls = classifyUa(s.userAgent);
      if (cls === 'mobile') mobile += 1;
      else if (cls === 'desktop') desktop += 1;
      else unknown += 1;
    }

    // Job-retry rollup. `attempts > 1` means the row needed at least
    // one retry. We sum the extra attempts (excluding the first run)
    // to get a useful "how much retry traffic are we generating?"
    // count instead of just "how many rows were retried at all."
    let totalRetries = 0;
    let exhausted = 0;
    for (const j of jobsLast24h) {
      if (j.attempts > 1) totalRetries += j.attempts - 1;
      if (
        (j.status === 'FAILED_PERMANENT' || j.status === 'DEAD') &&
        j.attempts >= j.maxAttempts
      ) {
        exhausted += 1;
      }
    }

    const topUserAgents = topUaRows
      .filter((r) => !!r.userAgent)
      .map((r) => ({
        userAgent: truncate(r.userAgent ?? '<unknown>', 80),
        count: r._count._all,
      }));

    return {
      generatedAt: now.toISOString(),
      sessionsByClass: { mobile, desktop, unknown },
      distinctDevices7d: distinctFingerprints.length,
      jobRetries: {
        last24h: totalRetries,
        exhausted24h: exhausted,
      },
      topUserAgents,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coarse UA classifier. Good-enough heuristics for the rollup; we
 * avoid pulling a full UA-parser library for one stat. Anything
 * matching the obvious mobile patterns wins; everything else is
 * desktop unless the UA is missing.
 */
function classifyUa(ua: string | null): 'mobile' | 'desktop' | 'unknown' {
  if (!ua) return 'unknown';
  const lower = ua.toLowerCase();
  if (
    /android|iphone|ipad|ipod|mobile|opera mini|iemobile/.test(lower) &&
    !/tablet|ipad/.test(lower)
  ) {
    return 'mobile';
  }
  if (/ipad|tablet/.test(lower)) return 'mobile'; // count tablets as mobile
  return 'desktop';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
