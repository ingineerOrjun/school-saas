import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { BackupStubService } from '../common/backup/backup-stub.service';
import { BackupService } from '../common/backup/backup.service';
import { JobQueueService } from '../common/jobs/job-queue.service';
import { CleanupService } from '../common/maintenance/cleanup.service';
import { MaintenanceWindowService } from '../common/maintenance/maintenance-window.service';
import { SecurityService } from '../platform/security.service';
import { BroadcastIncidentDto } from './dto/broadcast-incident.dto';
import { IncidentService } from './incident.service';
import { MobileMetricsService } from './mobile-metrics.service';
import { OperationsService, type OpsWindow } from './operations.service';

// ---------------------------------------------------------------------------
// OperationsController — Phase 21 SUPER_ADMIN-only ops cockpit API.
//
// Surface (one endpoint per Operations Center section):
//
//   GET  /platform/operations/overview         — Section 1 KPIs
//   GET  /platform/operations/requests         — Section 2 (window=15m|1h|24h)
//   GET  /platform/operations/jobs             — Section 3 queue + per-handler
//   POST /platform/operations/jobs/:id/retry   — operator retry
//   POST /platform/operations/jobs/:id/cancel  — operator cancel
//   GET  /platform/operations/jobs/:id         — inspect payload
//   GET  /platform/operations/health           — Section 4 subsystem grid
//   GET  /platform/operations/security         — Section 5 security feed
//   GET  /platform/operations/sessions         — Section 6 cross-tenant
//   POST /platform/operations/sessions/:userId/:sessionId/revoke
//   POST /platform/operations/users/:userId/sessions/revoke-all
//   GET  /platform/operations/schools          — Section 7 health grid
//   GET  /platform/operations/events           — Section 8 event ticker
//   GET  /platform/operations/incidents        — incident list (active + resolved)
//   POST /platform/operations/incidents        — broadcast a new incident
//   POST /platform/operations/incidents/:id/resolve — mark resolved
//
// All endpoints inherit the controller-level `platform` throttle bucket
// (300/min/user) — high enough that 15s polling across 8 sections in
// multiple operator tabs stays in budget, low enough that a runaway
// dashboard tab can't burn the API.
// ---------------------------------------------------------------------------

@Controller('platform/operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Throttle({ platform: { limit: 300, ttl: 60_000 } })
export class OperationsController {
  constructor(
    private readonly ops: OperationsService,
    private readonly queue: JobQueueService,
    private readonly incidents: IncidentService,
    private readonly security: SecurityService,
    private readonly maintenance: MaintenanceWindowService,
    private readonly cleanup: CleanupService,
    private readonly backups: BackupStubService,
    private readonly mobileMetrics: MobileMetricsService,
    private readonly backupEngine: BackupService,
  ) {}

  // ---------- Section 1 — Live overview ----------

  @Get('overview')
  getOverview() {
    return this.ops.getOverview();
  }

  // ---------- Section 2 — Request monitoring ----------

  @Get('requests')
  getRequests(@Query('window') window?: string) {
    const w = parseWindow(window);
    return this.ops.getRequestMonitoring(w);
  }

  // ---------- Section 3 — Job queue monitor ----------

  @Get('jobs')
  getJobs() {
    return this.ops.getJobMonitor();
  }

  @Get('jobs/:id')
  getJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.queue.inspect(id);
  }

  @Post('jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  retryJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.queue.retryFromOperator(id);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.queue.cancelFromOperator(id);
  }

  // ---------- Section 4 — Subsystem health ----------

  @Get('health')
  getHealth() {
    return this.ops.getHealth();
  }

  // ---------- Section 5 — Security feed ----------

  @Get('security')
  getSecurity(
    @Query('limit') limit?: string,
    @Query('schoolId') schoolId?: string,
  ) {
    return this.ops.getSecurityFeed({
      limit: limit ? Math.min(200, parseInt(limit, 10)) : undefined,
      schoolId,
    });
  }

  // ---------- Section 6 — Session monitor ----------

  @Get('sessions')
  getSessions(
    @Query('q') q?: string,
    @Query('schoolId') schoolId?: string,
    @Query('onlyOnline') onlyOnline?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.getSessionMonitor({
      q,
      schoolId,
      onlyOnline: onlyOnline === 'true' || onlyOnline === '1',
      limit: limit ? Math.min(100, parseInt(limit, 10)) : undefined,
    });
  }

  /**
   * Revoke a single session. Delegates to the existing SecurityService
   * which audits + writes the revocation row. The user controls
   * remain on /platform/users/:id for individual user actions; this
   * endpoint is the cockpit's per-row affordance.
   */
  @Post('sessions/:userId/:sessionId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeSession(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.security.revokeUserSession({
      userId,
      sessionId,
      actor: {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
      reason: 'operator revoke from /platform/operations',
    });
  }

  @Post('users/:userId/sessions/revoke-all')
  @HttpCode(HttpStatus.OK)
  revokeAllSessions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.security.forceLogoutUser(
      userId,
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
      'operator revoke-all from /platform/operations',
    );
  }

  // ---------- Section 7 — School health grid ----------

  @Get('schools')
  getSchools() {
    return this.ops.getSchoolHealthGrid();
  }

  // ---------- Section 8 — Event stream ----------

  @Get('events')
  getEvents(@Query('limit') limit?: string) {
    return this.ops.getEventStream({
      limit: limit ? Math.min(200, parseInt(limit, 10)) : undefined,
    });
  }

  // ---------- Phase 22 / Section 8 + 13 — Abuse detection ----------

  @Get('abuse')
  getAbuse() {
    return this.ops.getAbuseDetection();
  }

  // ---------- Phase 22 / Section 2 + 13 — Dead letter queue ----------

  @Get('dead-letters')
  getDeadLetters(
    @Query('name') name?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.getDeadLetterQueue({
      name,
      limit: limit ? Math.min(200, parseInt(limit, 10)) : undefined,
    });
  }

  /**
   * Bulk retry every dead-letter row, optionally scoped to one
   * handler. Capped server-side at 500 rows per call so one click
   * can't resurrect thousands of broken jobs at once.
   */
  @Post('dead-letters/retry')
  @HttpCode(HttpStatus.OK)
  bulkRetryDeadLetters(
    @Body() body: { name?: string; limit?: number },
  ) {
    return this.queue.bulkRetryDeadLetters({
      name: body.name,
      limit: body.limit,
    });
  }

  // ---------- Phase 22 / Section 3 + 13 — Circuit breakers ----------

  @Get('breakers')
  getBreakers() {
    return this.ops.getBreakers();
  }

  // ---------- Phase 22 / Section 5 + 13 — Correlation inspector ----------

  /**
   * Trace every artifact tagged with a given correlation id.
   * Operator pastes an `x-request-id` from a customer report and
   * gets the audit rows + jobs + notifications + incidents that
   * the request produced.
   */
  @Get('correlation/:id')
  getCorrelation(@Param('id') id: string) {
    return this.ops.getCorrelationTrace(id);
  }

  // ---------- Section 9 — Incident broadcast ----------

  @Get('incidents')
  listIncidents(@Query('activeOnly') activeOnly?: string) {
    return this.incidents.list({
      activeOnly: activeOnly === 'true' || activeOnly === '1',
    });
  }

  @Post('incidents')
  @HttpCode(HttpStatus.CREATED)
  broadcastIncident(
    @Body() dto: BroadcastIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.broadcast({
      severity: dto.severity,
      title: dto.title,
      body: dto.body,
      targetScope: dto.targetScope,
      targetSchoolIds:
        dto.targetScope === 'ALL_SCHOOLS' ? [] : dto.targetSchoolIds,
      actor: { userId: user.id, email: user.email },
    });
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolveIncident(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidents.resolve({
      incidentId: id,
      actor: { userId: user.id, email: user.email },
    });
  }

  // ---------- Phase 22 / Section 10 — Maintenance windows ----------

  /**
   * Manual sweep trigger — for ops to fast-forward an auto-toggle
   * without waiting for the cron tick (max ~60s wait otherwise).
   * Returns the count of schools whose `maintenanceMode` flipped.
   */
  @Post('maintenance/sweep')
  @HttpCode(HttpStatus.OK)
  triggerMaintenanceSweep() {
    return this.maintenance.tick();
  }

  // ---------- Phase 22 / Section 4 — Cleanup sweepers ----------

  /**
   * Manual cleanup trigger — operator-initiated. Useful for
   * "clean up before deploy" flows. The cron also runs daily
   * at 03:30 UTC.
   */
  @Post('cleanup/run')
  @HttpCode(HttpStatus.OK)
  triggerCleanup() {
    return this.cleanup.runAll();
  }

  // ---------- Phase 22 / Section 11 — Backups ----------

  /**
   * Phase α — real backups. The endpoint now returns the live
   * BackupService rollup. The Phase 22 stub stays around for any
   * legacy consumer; new UI binds to this richer payload.
   */
  @Get('backups')
  getBackups() {
    return this.backupEngine.getRollup();
  }

  /**
   * Phase α — operator-triggered ad-hoc backup. Useful before a
   * risky deploy when the daily 03:00 cron isn't soon enough.
   * Returns the resulting BackupRun row; the operator polls
   * /backups for the SUCCEEDED state.
   */
  @Post('backups/run')
  @HttpCode(HttpStatus.ACCEPTED)
  runBackup(@CurrentUser() user: AuthenticatedUser) {
    return this.backupEngine.runOnDemand(user.id);
  }

  /**
   * Phase α — operator gets the restore command for a successful
   * run. We deliberately do NOT execute restore from the API —
   * the operator copies the command + runs it against a clean DB.
   * See BackupService.getRestoreCommand for the safety reasoning.
   */
  @Get('backups/:id/restore-command')
  getRestoreCommand(@Param('id', ParseUUIDPipe) id: string) {
    return this.backupEngine.getRestoreCommand(id);
  }

  // ---------- Phase 26 / Section 7 — Mobile metrics ----------

  /**
   * Mobile-shaped operational rollup. Read-only aggregator over
   * Session + Job tables — no client-telemetry POST in this phase.
   * The shape is forward-compatible: client-side beacon endpoints
   * can land in a follow-up without changing this contract.
   */
  @Get('mobile-metrics')
  getMobileMetrics() {
    return this.mobileMetrics.getRollup();
  }
}

function parseWindow(raw: string | undefined): OpsWindow {
  if (raw === '15m' || raw === '1h' || raw === '24h') return raw;
  return '15m';
}
