import { api } from "./api";

// ============================================================================
// system.ts — Phase PLATFORM STABILIZATION Parts 4 + 7.
//
// School-admin facing operational health surface. Mirrors backend
// `SystemController`. Pure read-only — nothing here mutates server
// state. The System Health page consumes this lib.
// ============================================================================

export interface BackupHealth {
  configured: boolean;
  storageProvider: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: string | null;
  isFresh: boolean;
  hoursSinceLastSuccess: number | null;
  notice: string;
}

export type IntegrityCheckCode =
  | "STUDENT_DUPLICATE_REGNO"
  | "STUDENT_DUPLICATE_SYMBOL"
  | "STUDENT_ORPHANED_SECTION"
  | "STUDENT_REFERENCES_ARCHIVED_CLASS"
  | "STUDENT_REFERENCES_ARCHIVED_SECTION"
  | "EXAM_MISSING_SESSION"
  | "EXAM_REFERENCES_ARCHIVED_SESSION"
  | "RESULT_REFERENCES_ARCHIVED_EXAM"
  | "RESULT_REFERENCES_ARCHIVED_STUDENT"
  | "PROMOTION_MISSING_LINK"
  | "MULTIPLE_ACTIVE_SESSIONS"
  | "NO_ACTIVE_SESSION";

export type IntegrityCheckSeverity = "info" | "warning" | "error";

export interface IntegrityFinding {
  code: IntegrityCheckCode;
  severity: IntegrityCheckSeverity;
  message: string;
  count: number;
  sampleIds?: string[];
  remediation?: string;
}

export interface IntegrityReport {
  schoolId: string;
  generatedAt: string;
  clean: boolean;
  counts: {
    info: number;
    warnings: number;
    errors: number;
  };
  findings: IntegrityFinding[];
}

export const systemApi = {
  /** Phase PLATFORM STABILIZATION Part 4 — backup freshness summary. */
  backupStatus: () => api<BackupHealth>("/system/backup-status"),
  /** Phase PLATFORM STABILIZATION Part 7 — tenant-scoped data drift report. */
  integrityReport: () => api<IntegrityReport>("/system/integrity-report"),
};
