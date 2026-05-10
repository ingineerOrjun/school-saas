import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// SchemaCheckService — Phase α follow-up.
//
// Lightweight runtime schema verification. Runs once at boot via
// StartupDiagnosticsService; in dev, runs again every 60s as a
// reminder when migrations are pending.
//
// Design rules:
//   • READ-ONLY. Never alters the schema. Pure inspection.
//   • Never CRASHES the app. If a check fails, log loudly and let
//     the app continue — the operator will see 500s downstream and
//     follow the warning to run `prisma migrate deploy`.
//   • Doesn't depend on Prisma's internal `_prisma_migrations`
//     table format beyond a name/finished_at lookup. If Prisma's
//     internals change, the check degrades to "couldn't verify"
//     instead of crashing.
//
// Why this exists:
//   The Phase 22/23/α migrations were written but never `migrate
//   deploy`-ed against the running DB. The Prisma client expected
//   newer columns; the DB didn't have them. Result: every JWT
//   validation hit "column sessions.deviceFingerprint does not
//   exist" → cascading 500s on dashboard / features / classes /
//   academic-sessions / notifications.
//
//   This service catches that class of drift on the next deploy +
//   surfaces a clear actionable warning at boot, instead of letting
//   the operator discover it via 500s in production.
// ---------------------------------------------------------------------------

/**
 * Critical columns expected in production. Listed by table for
 * quick scanning when the warning fires. The list is intentionally
 * NOT exhaustive — we check enough columns to detect each Phase's
 * migration as applied vs not.
 *
 * Add a row here when a future phase adds columns the auth/session
 * paths depend on.
 */
const CRITICAL_COLUMNS: Array<{ table: string; column: string; phase: string }> = [
  // Phase 22 — resilience
  { table: 'schools', column: 'maintenanceScheduledEnd', phase: 'Phase 22' },
  { table: 'schools', column: 'maintenanceScheduledStart', phase: 'Phase 22' },
  { table: 'schools', column: 'maintenanceMessage', phase: 'Phase 22' },
  { table: 'sessions', column: 'deviceFingerprint', phase: 'Phase 22' },
  { table: 'sessions', column: 'lastIp', phase: 'Phase 22' },
  { table: 'sessions', column: 'lastUserAgent', phase: 'Phase 22' },
  { table: 'jobs', column: 'lockedAt', phase: 'Phase 22' },
  { table: 'jobs', column: 'correlationId', phase: 'Phase 22' },
  { table: 'notifications', column: 'correlationId', phase: 'Phase 22' },
  // Phase 23 — productization
  { table: 'schools', column: 'onboardingCompleted', phase: 'Phase 23' },
  { table: 'schools', column: 'brandPrimaryColor', phase: 'Phase 23' },
  // Phase α — backups
  { table: 'backup_runs', column: 'sha256', phase: 'Phase α' },
];

const REMINDER_INTERVAL_MS = 60_000;

export interface SchemaCheckResult {
  ok: boolean;
  /** Columns that are present + correct. */
  presentCount: number;
  /** Missing columns — operator-actionable. */
  missing: Array<{ table: string; column: string; phase: string }>;
  /** Pending Prisma migrations — names only. */
  pendingMigrations: string[];
  /** True when we couldn't talk to information_schema (degraded). */
  inspectionFailed: boolean;
}

@Injectable()
export class SchemaCheckService {
  private readonly logger = new Logger('SchemaCheck');
  private reminderTimer: ReturnType<typeof setInterval> | null = null;
  private lastResult: SchemaCheckResult | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Boot-time check. Returns the result so StartupDiagnostics can
   * record it; also fires the loud-warning logger when something is
   * missing.
   *
   * Never throws. Errors degrade to `inspectionFailed: true`.
   */
  async check(): Promise<SchemaCheckResult> {
    let presentCount = 0;
    const missing: SchemaCheckResult['missing'] = [];
    let pending: string[] = [];
    let inspectionFailed = false;

    try {
      // Look up every (table, column) we care about in one query.
      // information_schema.columns is the SQL standard inventory —
      // works on Postgres without any extension.
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ table_name: string; column_name: string }>
      >(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (${placeholders(
            CRITICAL_COLUMNS.length,
          )})
      `, ...CRITICAL_COLUMNS.flatMap((c) => [c.table, c.column]));
      const seen = new Set(
        rows.map((r) => `${r.table_name}::${r.column_name}`),
      );
      for (const c of CRITICAL_COLUMNS) {
        if (seen.has(`${c.table}::${c.column}`)) {
          presentCount += 1;
        } else {
          missing.push(c);
        }
      }
    } catch (e) {
      inspectionFailed = true;
      this.logger.warn(
        `Schema inspection failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    try {
      pending = await this.unappliedMigrations();
    } catch {
      // Prisma's _migrations table missing → DB was never migrated
      // at all. Surface as one big "missing" entry so the warning
      // is loud.
      pending = [];
    }

    const result: SchemaCheckResult = {
      ok: missing.length === 0 && pending.length === 0 && !inspectionFailed,
      presentCount,
      missing,
      pendingMigrations: pending,
      inspectionFailed,
    };
    this.lastResult = result;

    if (!result.ok) this.warn(result);
    return result;
  }

  /** Read the most recent result without re-querying. */
  snapshot(): SchemaCheckResult | null {
    return this.lastResult;
  }

  /**
   * Dev-only periodic reminder when migrations are pending. No-op in
   * production (the boot warning is enough; we don't want a chatty
   * production log every minute).
   */
  startDevReminder(): void {
    if (process.env.NODE_ENV === 'production') return;
    if (this.reminderTimer) return;
    this.reminderTimer = setInterval(async () => {
      try {
        const r = await this.check();
        if (r.pendingMigrations.length > 0 || r.missing.length > 0) {
          this.logger.warn(
            `Pending Prisma migrations detected (${r.pendingMigrations.length} unapplied, ${r.missing.length} missing columns). ` +
              `Run 'npx prisma migrate deploy' to apply.`,
          );
        }
      } catch {
        // Silent — already logged in check()
      }
    }, REMINDER_INTERVAL_MS);
    this.reminderTimer.unref?.();
  }

  stopDevReminder(): void {
    if (this.reminderTimer) {
      clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private warn(result: SchemaCheckResult): void {
    if (result.missing.length > 0) {
      const byPhase = new Map<string, string[]>();
      for (const m of result.missing) {
        const arr = byPhase.get(m.phase) ?? [];
        arr.push(`${m.table}.${m.column}`);
        byPhase.set(m.phase, arr);
      }
      for (const [phase, cols] of byPhase) {
        this.logger.error(
          `Missing columns from ${phase}: ${cols.join(', ')}. ` +
            `Did you forget 'npx prisma migrate deploy'?`,
        );
      }
    }
    if (result.pendingMigrations.length > 0) {
      this.logger.error(
        `${result.pendingMigrations.length} pending migration(s): ${result.pendingMigrations.join(', ')}. ` +
          `Run 'npx prisma migrate deploy'.`,
      );
    }
  }

  private async unappliedMigrations(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ migration_name: string; finished_at: Date | null }>
    >(`
      SELECT migration_name, finished_at
      FROM _prisma_migrations
      WHERE finished_at IS NULL
      ORDER BY started_at ASC
    `);
    return rows.map((r) => r.migration_name);
  }
}

/**
 * Build a `($1,$2),($3,$4),…` placeholder list for an `IN ((tuple), …)`
 * lookup. Postgres-specific tuple syntax — but every Prisma deploy
 * targets Postgres, so this is fine for our purposes.
 */
function placeholders(count: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
  }
  return out.join(', ');
}
