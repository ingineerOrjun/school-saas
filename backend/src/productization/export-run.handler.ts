import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type JobContext,
  type JobHandler,
} from '../common/jobs/job-handler.interface';
import { PrismaService } from '../database/prisma.service';
import { EXPORT_JOB_NAME, ExportService } from './export.service';

// ---------------------------------------------------------------------------
// ExportRunHandler — Phase 23 Section 8 worker.
//
// Dispatches on the persisted `entity` field — one render function
// per (entity, format) pair. Phase 23 ships ONE concrete pair:
// `students` → `csv`. Every other combo returns a "not yet
// implemented" SKIPPED row so the API surface is honest about what
// works today.
//
// Output goes to `<cwd>/uploads/exports/<runId>.<ext>` so the
// existing ServeStaticModule mount at `/uploads` makes the file
// downloadable without additional infra. A future cloud-storage
// backend can swap this for an S3 put + presigned URL with no
// API change.
//
// Failure modes:
//   • Unknown (entity, format) pair → markFailed with an actionable
//     message ("This combination isn't implemented yet.").
//   • Render error → markFailed with the upstream message.
//   • All other errors propagate so the job runner backs off + retries.
// ---------------------------------------------------------------------------

const EXPORTS_DIR = join(process.cwd(), 'uploads', 'exports');

interface ExportPayload {
  exportRunId: string;
  schoolId: string;
}

@Injectable()
export class ExportRunHandler implements JobHandler {
  readonly name = EXPORT_JOB_NAME;
  private readonly logger = new Logger(ExportRunHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exports: ExportService,
  ) {}

  async run(payload: unknown, _ctx: JobContext): Promise<void> {
    const p = payload as ExportPayload;
    if (!p?.exportRunId) {
      throw new Error('export.run payload missing exportRunId');
    }

    const run = await this.prisma.dataExportRun.findUnique({
      where: { id: p.exportRunId },
    });
    if (!run) {
      this.logger.warn(`Export run ${p.exportRunId} vanished — skipping.`);
      return;
    }

    await this.exports.markRunning(run.id);

    try {
      await fs.mkdir(EXPORTS_DIR, { recursive: true });

      let body: string;
      let extension: string;

      if (run.entity === 'students' && run.format === 'csv') {
        const result = await this.renderStudentsCsv(run.schoolId);
        body = result.body;
        extension = 'csv';
      } else {
        await this.exports.markFailed({
          runId: run.id,
          error: `Export for entity="${run.entity}" format="${run.format}" is not yet implemented. Phase 23 ships students→csv only.`,
        });
        return;
      }

      const filename = `${run.id}.${extension}`;
      const fullPath = join(EXPORTS_DIR, filename);
      await fs.writeFile(fullPath, body, 'utf8');

      const sizeBytes = Buffer.byteLength(body, 'utf8');
      await this.exports.markSucceeded({
        runId: run.id,
        outputUrl: `/uploads/exports/${filename}`,
        sizeBytes,
      });
      this.logger.log(
        `[exports] succeeded run=${run.id} bytes=${sizeBytes}`,
      );
    } catch (e) {
      await this.exports.markFailed({
        runId: run.id,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // Concrete renderers
  // -------------------------------------------------------------------------

  private async renderStudentsCsv(schoolId: string): Promise<{ body: string }> {
    const students = await this.prisma.student.findMany({
      where: { schoolId },
      orderBy: [{ classId: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        symbolNumber: true,
        class: { select: { name: true } },
        section: { select: { name: true } },
        createdAt: true,
      },
    });

    // Minimal but useful CSV. Every cell escaped via the tiny
    // helper below; double-quote any field containing comma /
    // quote / newline. RFC 4180 compliant.
    const headers = [
      'id',
      'firstName',
      'lastName',
      'symbolNumber',
      'className',
      'sectionName',
      'createdAt',
    ];
    const lines = [headers.join(',')];
    for (const s of students) {
      lines.push(
        [
          csv(s.id),
          csv(s.firstName),
          csv(s.lastName),
          csv(s.symbolNumber ?? ''),
          csv(s.class?.name ?? ''),
          csv(s.section?.name ?? ''),
          csv(s.createdAt.toISOString()),
        ].join(','),
      );
    }
    return { body: lines.join('\n') + '\n' };
  }
}

function csv(field: string): string {
  if (/[",\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
