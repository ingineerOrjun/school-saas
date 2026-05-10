import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobRegistry } from '../jobs/job-registry.service';
import { JobQueueService } from '../jobs/job-queue.service';
import { PrismaService } from '../../database/prisma.service';
import { SchemaCheckService } from './schema-check.service';

// ---------------------------------------------------------------------------
// StartupDiagnosticsService — Phase 22.
//
// Runs once at boot, before Nest starts listening. Emits a single
// structured "boot summary" log line and exits the process on a
// hard probe failure. The orchestrator (Docker / k8s / systemd)
// sees a clean non-zero exit and refuses to route traffic to a
// half-broken pod.
//
// Probes:
//
//   • DB                — Prisma SELECT 1
//   • job-queue table   — readable count() (verifies migration applied)
//   • job handlers      — JobRegistry.list().length > 0
//   • mail provider     — config check (MAIL_PROVIDER set)
//   • required env      — JWT_SECRET, DATABASE_URL
//
// Why a dedicated service (not inline in main.ts):
//   • Each probe runs through Nest DI, so it sees the same Prisma /
//     queue / config singletons the rest of the app uses.
//   • Failures map to descriptive structured log lines instead of
//     a stack trace through the bootstrap promise.
//   • Easy to extend — adding a "Redis reachable" probe later is a
//     one-method change.
//
// Hard vs soft failures:
//   • DB unreachable, env missing → HARD, process exits.
//   • Mail provider misconfigured → SOFT, log warning + continue.
//     Most workloads can run without sending email; better to come
//     up than to refuse to boot.
// ---------------------------------------------------------------------------

interface ProbeResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  durationMs: number;
}

@Injectable()
export class StartupDiagnosticsService {
  private readonly logger = new Logger('Startup');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistry,
    private readonly queue: JobQueueService,
    private readonly config: ConfigService,
    private readonly schemaCheck: SchemaCheckService,
  ) {}

  /**
   * Run all probes. On any HARD failure, log an error and call
   * `process.exit(1)`. On warnings, log + continue. On all-green,
   * emit a single "ready" line.
   *
   * Returns void on success; never resolves on failure (process exit
   * happens before the await unblocks).
   */
  async runOrExit(): Promise<void> {
    const results: ProbeResult[] = [];

    results.push(await this.probe('env', () => this.checkEnv()));
    results.push(await this.probe('database', () => this.checkDatabase()));
    // Phase α follow-up — verify the DB schema matches the Prisma
    // client expectations. Catches "ran the app without applying
    // migrations" as a loud warning at boot instead of a 500 storm
    // at the first authenticated request.
    results.push(await this.probe('schema', () => this.checkSchema()));
    results.push(
      await this.probe('jobs.table', () => this.checkJobTable()),
    );
    results.push(
      await this.probe('jobs.handlers', () => this.checkHandlers()),
    );
    results.push(
      await this.probe('mail.provider', () => this.checkMailProvider()),
    );

    const hardFails = results.filter((r) => r.status === 'fail');
    const warnings = results.filter((r) => r.status === 'warn');

    if (hardFails.length > 0) {
      this.logger.error(
        `Startup diagnostics FAILED: ${hardFails.map((r) => `${r.name}=${r.detail}`).join(' · ')}`,
      );
      // Give the logger a tick to flush before exit.
      await new Promise((r) => setImmediate(r));
      process.exit(1);
    }

    for (const w of warnings) {
      this.logger.warn(`probe ${w.name}: ${w.detail}`);
    }

    const summary = results
      .map((r) => `${r.name}=${r.status}(${r.durationMs.toFixed(0)}ms)`)
      .join(' · ');
    this.logger.log(`Startup diagnostics OK — ${summary}`);

    // Phase α follow-up — start the dev-only periodic schema reminder.
    // No-op in production (the boot warning + subsequent log lines
    // from query failures are enough). In dev, every minute the
    // service re-checks and warns if migrations land out of sync.
    this.schemaCheck.startDevReminder();
  }

  // -------------------------------------------------------------------------
  // Individual probes
  // -------------------------------------------------------------------------

  private checkEnv(): ProbeResult['detail'] | { fail: string } {
    const missing: string[] = [];
    if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
    if (missing.length > 0) {
      return { fail: `missing env: ${missing.join(', ')}` };
    }
    return `${Object.keys(process.env).length} env vars present`;
  }

  private async checkDatabase(): Promise<string | { fail: string }> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return 'connected';
    } catch (e) {
      return {
        fail: `DB probe failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * Phase α follow-up. Inspects information_schema for the columns
   * recent migrations added; reports a WARNING (not failure) when
   * any are missing so the operator notices before the first
   * authenticated request 500s. Soft-failure by design — the app
   * still boots so static / unauth routes remain reachable.
   */
  private async checkSchema(): Promise<string | { warn: string }> {
    const result = await this.schemaCheck.check();
    if (result.inspectionFailed) {
      return { warn: 'schema inspection failed (information_schema unreadable)' };
    }
    if (result.pendingMigrations.length > 0) {
      return {
        warn: `${result.pendingMigrations.length} pending migration(s) — run 'npx prisma migrate deploy'`,
      };
    }
    if (result.missing.length > 0) {
      const sample = result.missing.slice(0, 3).map(
        (m) => `${m.table}.${m.column}`,
      );
      const more = result.missing.length > 3 ? ` (+${result.missing.length - 3} more)` : '';
      return {
        warn: `${result.missing.length} missing column(s): ${sample.join(', ')}${more} — run 'npx prisma migrate deploy'`,
      };
    }
    return `${result.presentCount} critical columns present`;
  }

  private async checkJobTable(): Promise<string | { fail: string }> {
    try {
      const count = await this.queue.stats();
      const total = Object.values(count).reduce((s, n) => s + n, 0);
      return `${total} job rows`;
    } catch (e) {
      return {
        fail: `jobs table unreadable: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  private checkHandlers(): string | { warn: string } {
    const handlers = this.registry.list();
    if (handlers.length === 0) {
      return { warn: 'no job handlers registered' };
    }
    return `${handlers.length} handlers: ${handlers.slice(0, 5).join(', ')}${handlers.length > 5 ? '…' : ''}`;
  }

  private checkMailProvider(): string | { warn: string } {
    const provider = this.config.get<string>('mail.provider') ?? 'console';
    if (provider === 'console') {
      return { warn: 'MAIL_PROVIDER=console (dev mode — no real emails sent)' };
    }
    if (provider === 'smtp') {
      const host = this.config.get<string>('mail.smtp.host');
      if (!host) {
        return {
          warn: 'MAIL_PROVIDER=smtp but MAIL_SMTP_HOST is unset',
        };
      }
      return `smtp via ${host}`;
    }
    return `provider=${provider}`;
  }

  // -------------------------------------------------------------------------
  // Probe wrapper — uniform timing + result shape.
  // -------------------------------------------------------------------------

  private async probe(
    name: string,
    fn: () => Promise<string | { fail?: string; warn?: string }> | string | { fail?: string; warn?: string },
  ): Promise<ProbeResult> {
    const startNs = process.hrtime.bigint();
    try {
      const out = await fn();
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      if (typeof out === 'string') {
        return { name, status: 'ok', detail: out, durationMs };
      }
      if (out.fail) {
        return { name, status: 'fail', detail: out.fail, durationMs };
      }
      if (out.warn) {
        return { name, status: 'warn', detail: out.warn, durationMs };
      }
      return { name, status: 'ok', detail: '', durationMs };
    } catch (e) {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      return {
        name,
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
        durationMs,
      };
    }
  }
}
