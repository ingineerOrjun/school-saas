// ---------------------------------------------------------------------------
// Backup foundations — Phase 22 (Section 11).
//
// Interfaces only. The full backup engine (point-in-time snapshots,
// WAL shipping, restore orchestration) is out of scope for this phase
// — but defining the shape now means:
//
//   • The Operations Center can render placeholder cards that don't
//     break when the real engine lands.
//   • The /platform/operations/backups endpoint has a stable contract.
//   • Every storage backend (local, S3, GCS, Azure Blob) implements
//     ONE interface, so swapping providers is one line in DI.
//
// When the real engine ships:
//   • A SnapshotService implementation calls `pg_dump --format=custom`
//     (or PG's continuous archiving) and uploads via StorageProvider.
//   • A RestoreService verifies + applies a snapshot; gated behind
//     a separate confirmation flow because the action is destructive.
//   • This file stays the same — implementations land in
//     /common/backup/snapshot.service.ts etc.
// ---------------------------------------------------------------------------

export type BackupKind = 'FULL' | 'INCREMENTAL' | 'WAL';
export type BackupStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/**
 * Metadata for one backup snapshot. Persisted in the operator's
 * choice of storage; the in-memory placeholder stub returns this
 * shape for the UI to render against.
 */
export interface SnapshotMetadata {
  id: string;
  kind: BackupKind;
  status: BackupStatus;
  /** Storage backend that holds the artifact. */
  storage: string;
  /** Provider-specific URL or path (s3://, gs://, /var/snapshots/...). */
  location: string;
  /** Bytes on disk after compression. */
  sizeBytes: number;
  /** Optional checksum for tamper detection. */
  sha256: string | null;
  startedAt: string;
  completedAt: string | null;
  /** Last error when status === FAILED. */
  errorMessage: string | null;
  /** ISO timestamp the snapshot covers up to (point-in-time anchor). */
  pitrAnchor: string;
}

/**
 * One restore operation. Restores are operator-initiated and audited.
 * The real implementation gates the actual restore behind:
 *   • SUPER_ADMIN role
 *   • Explicit confirmation typed by the operator
 *   • Maintenance mode enabled for the target tenant
 */
export interface RestoreJobMetadata {
  id: string;
  snapshotId: string;
  status: BackupStatus;
  /** Tenant scope — null = full restore. */
  scopeSchoolId: string | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  triggeredById: string;
}

/**
 * Storage provider abstraction. Real implementations:
 *
 *   • LocalDiskProvider   — for dev / single-host deployments.
 *   • S3Provider          — for AWS / R2 / MinIO.
 *   • GcsProvider         — for GCP.
 *
 * One interface keeps the snapshot/restore services unaware of
 * where bytes physically live.
 */
export interface BackupStorageProvider {
  /** Stable identifier for the OperationsCenter UI ("s3", "local"). */
  readonly name: string;

  /** Push a snapshot artifact + metadata. Returns the absolute URL/path. */
  put(input: {
    key: string;
    data: Buffer | NodeJS.ReadableStream;
    contentType?: string;
  }): Promise<{ location: string; sizeBytes: number; sha256: string }>;

  /** Read a snapshot artifact. */
  get(key: string): Promise<{ data: NodeJS.ReadableStream; sizeBytes: number }>;

  /** List snapshot keys, newest first. */
  list(prefix: string, limit?: number): Promise<string[]>;

  /** Delete an artifact (used by retention sweepers). */
  delete(key: string): Promise<void>;
}
