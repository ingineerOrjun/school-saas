import { Injectable } from '@nestjs/common';
import { BackupService } from '../common/backup/backup.service';

// ============================================================================
// BackupStatusService — Phase PLATFORM STABILIZATION Part 4.
//
// Thin school-admin-facing read surface over the existing
// `BackupService`. The platform-side BackupService already owns the
// scheduled run + retention sweeper + restore-command generator;
// this service exposes a deliberately small "is my data safe?" shape
// that the school admin's System Health page can render without
// pulling in the full operator-tier BackupRunSummary[] list.
//
// Why a separate service:
//   • BackupService is SUPER_ADMIN scope. Pulling the full run list
//     leaks operator info (storage provider, sha256, file path) that
//     a school admin doesn't need.
//   • The status shape here is stable for the frontend regardless of
//     storage-provider changes — we only forward the boolean fitness
//     signal + timestamps.
//
// Read-only. Never triggers a backup. Never returns paths.
// ============================================================================

/** Threshold beyond which a backup is considered stale (24h). */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface BackupHealth {
  /** `true` when the storage provider is configured + reachable. */
  configured: boolean;
  /** Display label for the active storage provider (e.g. "local-disk"). */
  storageProvider: string;
  /** Last successful backup ISO timestamp, or null when there's never been one. */
  lastSuccessAt: string | null;
  /** ISO timestamp of the most recent run regardless of status. Useful
   *  for "we tried at 03:00 but it failed" surfaces. */
  lastAttemptAt: string | null;
  /** Status of the most recent run (SUCCEEDED / FAILED / RUNNING / PENDING). */
  lastAttemptStatus: string | null;
  /** Convenience: derived from `lastSuccessAt` + the 24h stale threshold. */
  isFresh: boolean;
  /** Hours since the last successful backup. Null when never succeeded. */
  hoursSinceLastSuccess: number | null;
  /** Operator-grade explanatory note from the storage provider. */
  notice: string;
}

@Injectable()
export class BackupStatusService {
  constructor(private readonly backups: BackupService) {}

  /**
   * Build the school-admin-facing health snapshot. Soft-fails on any
   * underlying error — returns a `configured: false` skeleton rather
   * than throwing, so the admin page can still render with a warning
   * banner when the backup engine is misbehaving.
   */
  async getHealth(): Promise<BackupHealth> {
    try {
      const rollup = await this.backups.getRollup();
      const lastSuccessAt = rollup.capability.lastSuccessAt;
      const lastAttempt = rollup.runs[0] ?? null;
      const now = Date.now();
      const lastSuccessMs = lastSuccessAt
        ? new Date(lastSuccessAt).getTime()
        : null;
      const hoursSinceLastSuccess =
        lastSuccessMs !== null
          ? Math.round((now - lastSuccessMs) / 36e5)
          : null;
      const isFresh =
        lastSuccessMs !== null && now - lastSuccessMs < STALE_THRESHOLD_MS;
      return {
        configured: rollup.capability.configured,
        storageProvider: rollup.capability.storageProvider,
        lastSuccessAt,
        lastAttemptAt: lastAttempt?.completedAt ?? lastAttempt?.startedAt ?? null,
        lastAttemptStatus: lastAttempt?.status ?? null,
        isFresh,
        hoursSinceLastSuccess,
        notice: rollup.capability.notice,
      };
    } catch {
      // Soft-fail — surface "unknown" health rather than 500ing.
      return {
        configured: false,
        storageProvider: 'unknown',
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastAttemptStatus: null,
        isFresh: false,
        hoursSinceLastSuccess: null,
        notice: 'Backup status temporarily unavailable. Check operator logs.',
      };
    }
  }
}
