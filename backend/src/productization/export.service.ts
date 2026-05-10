import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type DataExportRun } from '@prisma/client';
import { JobQueueService } from '../common/jobs/job-queue.service';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// ExportService — Phase 23 Section 8.
//
// School-initiated data exports.
//
// Flow:
//   1. School admin POSTs /exports { entity, format, filters }.
//   2. We persist a DataExportRun row in PENDING + enqueue a job.
//   3. The export job handler renders the artifact (CSV/XLSX/PDF),
//      writes it via the storage abstraction, sets `outputUrl` +
//      `expiresAt` + flips status to SUCCEEDED.
//   4. School polls /exports — once SUCCEEDED, the UI surfaces the
//      download link.
//   5. Cleanup sweeper purges files past `expiresAt`.
//
// Phase 23 ships:
//   • Tracking model + endpoints (full)
//   • Job-handler dispatcher pattern (full)
//   • One concrete handler for `students` → CSV (works end-to-end
//     into the existing `/uploads` static directory)
//
// Deferred to follow-up phases:
//   • XLSX/PDF generators
//   • Other entities (fees, attendance, results, audit)
//   • Real cloud storage backend (current handler writes to local
//     `/uploads/exports` with the existing static-serve config)
// ---------------------------------------------------------------------------

export type ExportEntity = 'students' | 'fees' | 'attendance' | 'results' | 'audit';
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportRunRow {
  id: string;
  schoolId: string;
  requestedById: string;
  entity: string;
  format: string;
  status: string;
  outputUrl: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

const EXPORT_JOB_NAME = 'export.run';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
  ) {}

  /**
   * Request a new export. Persists the tracking row + enqueues a
   * job with the run id in the payload. The handler picks it up
   * asynchronously.
   */
  async request(input: {
    schoolId: string;
    requestedById: string;
    entity: ExportEntity;
    format: ExportFormat;
    filters?: Record<string, unknown>;
  }): Promise<ExportRunRow> {
    const created = await this.prisma.dataExportRun.create({
      data: {
        schoolId: input.schoolId,
        requestedById: input.requestedById,
        entity: input.entity,
        format: input.format,
        filters: (input.filters ?? {}) as never,
        status: 'PENDING',
      },
    });
    await this.queue.enqueue({
      name: EXPORT_JOB_NAME,
      payload: { exportRunId: created.id, schoolId: input.schoolId },
      dedupeKey: `export:${created.id}`,
    });
    this.logger.log(
      `[exports] requested run=${created.id} entity=${input.entity} format=${input.format}`,
    );
    return toRow(created);
  }

  async list(schoolId: string): Promise<ExportRunRow[]> {
    const rows = await this.prisma.dataExportRun.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toRow);
  }

  async get(input: { schoolId: string; runId: string }): Promise<ExportRunRow> {
    const row = await this.prisma.dataExportRun.findFirst({
      where: { id: input.runId, schoolId: input.schoolId },
    });
    if (!row) throw new NotFoundException('Export run not found.');
    return toRow(row);
  }

  // -------------------------------------------------------------------------
  // Internal: state transitions used by the job handler.
  // -------------------------------------------------------------------------

  async markRunning(runId: string): Promise<void> {
    await this.prisma.dataExportRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  async markSucceeded(input: {
    runId: string;
    outputUrl: string;
    sizeBytes: number;
    expiresAt?: Date;
  }): Promise<void> {
    const expires =
      input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60_000);
    await this.prisma.dataExportRun.update({
      where: { id: input.runId },
      data: {
        status: 'SUCCEEDED',
        outputUrl: input.outputUrl,
        sizeBytes: input.sizeBytes,
        expiresAt: expires,
        completedAt: new Date(),
      },
    });
  }

  async markFailed(input: { runId: string; error: string }): Promise<void> {
    await this.prisma.dataExportRun.update({
      where: { id: input.runId },
      data: {
        status: 'FAILED',
        errorMessage: input.error.slice(0, 1024),
        completedAt: new Date(),
      },
    });
  }
}

function toRow(r: DataExportRun): ExportRunRow {
  return {
    id: r.id,
    schoolId: r.schoolId,
    requestedById: r.requestedById,
    entity: r.entity,
    format: r.format,
    status: r.status,
    outputUrl: r.outputUrl,
    sizeBytes: r.sizeBytes,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

export { EXPORT_JOB_NAME };
