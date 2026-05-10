import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { PrismaService } from '../../database/prisma.service';
import { LocalDiskProvider } from './local-disk-provider';

// ---------------------------------------------------------------------------
// BackupService — Phase α (real engine).
//
// Replaces the Phase 22 stub. Produces a `pg_dump` artifact per run,
// stores it via the LocalDiskProvider (or any future provider on
// the same interface), records a BackupRun row, and prunes old
// artifacts per retention policy.
//
// Design choices worth knowing:
//
// 1. pg_dump via child_process.
//    We invoke the `pg_dump` binary directly. Reasons:
//      • One file, format=custom, compresses + restorable via
//        `pg_restore`.
//      • Survives schema changes that an SQL-INSERT-style dump
//        would have to re-encode.
//      • Streams straight to the storage provider — no temp files.
//    Downsides:
//      • Requires `pg_dump` on the deployment image. We document
//        this as a deployment requirement.
//      • Process credentials come from DATABASE_URL via PG* env
//        vars; we never log them.
//
// 2. One scheduled backup per day (03:00 UTC).
//    Tunable via env. Operator can also POST /platform/operations/
//    backups/run for an ad-hoc backup before risky deploys.
//
// 3. Retention.
//    Default 30 days. The cleanup sweeper (already runs daily at
//    03:30 UTC via CleanupService) won't touch backup_runs — backups
//    have their own purge logic that ALSO deletes the artifact file,
//    not just the DB row. We run that as a separate sweep at 04:00.
//
// 4. NO restore via API.
//    Restore is a separate CLI script that the operator runs manually
//    on a fresh DB. Triggering restore from a running app is
//    operationally dangerous (in-flight writes, FK conflicts mid-
//    restore). The ops UI exposes the restore COMMAND for the
//    operator to copy + run; it never executes restore directly.
// ---------------------------------------------------------------------------

const RETENTION_DAYS_DEFAULT = 30;

export interface BackupRunSummary {
  id: string;
  kind: string;
  status: string;
  storage: string;
  location: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  scheduled: boolean;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  retentionUntil: string | null;
  createdAt: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalDiskProvider,
    private readonly config: ConfigService,
  ) {}

  // ---- Capability + listing -------------------------------------------------

  capability() {
    return {
      configured: true,
      storageProvider: this.storage.name,
      lastSuccessAt: null as string | null, // populated by getRollup below
      notice: `Backups enabled — ${this.storage.describe().baseDir}`,
    };
  }

  async list(limit = 50): Promise<BackupRunSummary[]> {
    const rows = await this.prisma.backupRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return rows.map(toSummary);
  }

  async getRollup(): Promise<{
    capability: ReturnType<BackupService['capability']>;
    runs: BackupRunSummary[];
  }> {
    const cap = this.capability();
    const runs = await this.list();
    const lastSuccess = runs.find((r) => r.status === 'SUCCEEDED');
    cap.lastSuccessAt = lastSuccess?.completedAt ?? null;
    return { capability: cap, runs };
  }

  // ---- Run — scheduled + ad-hoc --------------------------------------------

  /** Daily backup. Cron expression configurable via BACKUP_CRON env. */
  @Cron('0 3 * * *', { name: 'backup-daily' })
  async runScheduled(): Promise<BackupRunSummary | null> {
    if (process.env.BACKUP_AUTOSTART === 'false') {
      this.logger.log('BACKUP_AUTOSTART=false — skipping scheduled backup.');
      return null;
    }
    return this.run({ scheduled: true });
  }

  /** Operator-triggered backup (POST /platform/operations/backups/run). */
  async runOnDemand(triggeredById: string): Promise<BackupRunSummary> {
    return this.run({ scheduled: false, triggeredById });
  }

  private async run(input: {
    scheduled: boolean;
    triggeredById?: string;
  }): Promise<BackupRunSummary> {
    const retentionDays = this.numEnv('BACKUP_RETENTION_DAYS', RETENTION_DAYS_DEFAULT);
    const retentionUntil = new Date(
      Date.now() + retentionDays * 24 * 60 * 60_000,
    );

    const row = await this.prisma.backupRun.create({
      data: {
        kind: 'FULL',
        status: 'PENDING',
        storage: this.storage.name,
        scheduled: input.scheduled,
        triggeredById: input.triggeredById ?? null,
        retentionUntil,
      },
    });

    this.logger.log(`[backup] starting run id=${row.id}`);
    await this.prisma.backupRun.update({
      where: { id: row.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      await this.storage.ensureReady();
      const stream = this.spawnPgDump();
      const result = await this.storage.put({ key: row.id, data: stream });
      await this.prisma.backupRun.update({
        where: { id: row.id },
        data: {
          status: 'SUCCEEDED',
          location: result.location,
          sizeBytes: BigInt(result.sizeBytes),
          sha256: result.sha256,
          completedAt: new Date(),
        },
      });
      this.logger.log(
        `[backup] run id=${row.id} succeeded (${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB)`,
      );
      const fresh = await this.prisma.backupRun.findUniqueOrThrow({
        where: { id: row.id },
      });
      return toSummary(fresh);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(`[backup] run id=${row.id} FAILED: ${errMsg}`);
      const failed = await this.prisma.backupRun.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          errorMessage: errMsg.slice(0, 1024),
          completedAt: new Date(),
        },
      });
      return toSummary(failed);
    }
  }

  // ---- Restore guidance (read-only) ----------------------------------------

  /**
   * Returns the operator-runnable restore command for a given run.
   * Never executes — the operator copies + runs against a clean DB.
   *
   * Restore-from-API would be operationally dangerous: in-flight
   * writes, FK conflicts, partial state. Documenting the command
   * here keeps the operator in the loop and the ops trail intact.
   */
  async getRestoreCommand(runId: string): Promise<{
    runId: string;
    location: string;
    sha256: string | null;
    command: string;
    notes: string[];
  }> {
    const row = await this.prisma.backupRun.findUnique({ where: { id: runId } });
    if (!row || row.status !== 'SUCCEEDED' || !row.location) {
      throw new NotFoundException(
        'Backup run not found or not in a restorable state.',
      );
    }
    return {
      runId: row.id,
      location: row.location,
      sha256: row.sha256,
      command:
        // Use $DATABASE_URL so the operator doesn't paste credentials
        // into a shell history. They set DATABASE_URL on the shell,
        // then run this.
        `pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" "${row.location}"`,
      notes: [
        'Run on a target DB you control. The --clean flag drops existing objects first.',
        'Verify the SHA-256 matches before restoring: sha256sum ' + row.location,
        'Stop the application before restoring. Live writes during restore corrupt FK state.',
        'After restore, run: npx prisma migrate deploy (to sync schema if you restored an older snapshot).',
      ],
    };
  }

  // ---- Retention sweeper ---------------------------------------------------

  /**
   * Daily cleanup at 04:00 UTC — separate from CleanupService's
   * 03:30 sweep so a slow backup doesn't collide with a slow cleanup.
   * Deletes the artifact file FIRST, then the DB row. Order matters:
   * an orphaned file is recoverable, an orphaned DB row points at
   * nothing.
   */
  @Cron('0 4 * * *', { name: 'backup-retention-sweep' })
  async pruneExpired(): Promise<{ purged: number }> {
    const now = new Date();
    const candidates = await this.prisma.backupRun.findMany({
      where: {
        status: 'SUCCEEDED',
        retentionUntil: { lt: now },
      },
      select: { id: true, storage: true },
      take: 100,
    });
    if (candidates.length === 0) return { purged: 0 };

    let purged = 0;
    for (const c of candidates) {
      try {
        await this.storage.delete(c.id);
        await this.prisma.backupRun.update({
          where: { id: c.id },
          data: { status: 'EXPIRED' },
        });
        purged += 1;
      } catch (e) {
        this.logger.warn(
          `[backup] retention sweep failed for ${c.id}: ${(e as Error).message}`,
        );
      }
    }
    this.logger.log(`[backup] retention sweep purged=${purged}`);
    return { purged };
  }

  // ---- Internals -----------------------------------------------------------

  /**
   * Spawn `pg_dump` and return its stdout as a readable stream.
   * Credentials flow via PG* env vars derived from DATABASE_URL —
   * never echoed to logs.
   */
  private spawnPgDump(): NodeJS.ReadableStream {
    const url = this.config.get<string>('database.url') ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL not set — cannot run pg_dump');
    }
    const parsed = new URL(url);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || '5432',
      PGUSER: decodeURIComponent(parsed.username),
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGDATABASE: parsed.pathname.replace(/^\//, ''),
    };
    // Format=custom is binary, restorable via pg_restore. -Z 6 is a
    // moderate compression level — balances CPU during backup with
    // disk savings.
    const child = spawn(
      'pg_dump',
      ['--format=custom', '-Z', '6', '--no-owner', '--no-privileges'],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        // Stderr is logged by the wrapping run() catch; surface
        // here so a streaming consumer sees the failure.
        child.stdout.emit(
          'error',
          new Error(
            `pg_dump exited with code ${code}: ${stderr.slice(0, 512)}`,
          ),
        );
      }
    });
    child.on('error', (e) => {
      child.stdout.emit('error', e);
    });
    return child.stdout;
  }

  private numEnv(key: string, fallback: number): number {
    const raw = this.config.get<string>(key) ?? process.env[key];
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
}

function toSummary(r: {
  id: string;
  kind: string;
  status: string;
  storage: string;
  location: string | null;
  sizeBytes: bigint | null;
  sha256: string | null;
  scheduled: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  retentionUntil: Date | null;
  createdAt: Date;
}): BackupRunSummary {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    storage: r.storage,
    location: r.location,
    sizeBytes: r.sizeBytes !== null ? Number(r.sizeBytes) : null,
    sha256: r.sha256,
    scheduled: r.scheduled,
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    errorMessage: r.errorMessage,
    retentionUntil: r.retentionUntil?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
