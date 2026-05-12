import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { BackupStatusService } from './backup-status.service';
import { IntegrityCheckService } from './integrity-check.service';

// ============================================================================
// SystemController — Phase PLATFORM STABILIZATION Parts 4 + 6 + 7.
//
// School-admin-facing operational surface. Returns lightweight read-
// only health reports that the System Health page in the dashboard
// consumes. Not to be confused with `/operations/*` (SUPER_ADMIN
// operator-tier cockpit) or `/health/*` (unauthenticated probes).
//
// Tenant scope: every endpoint resolves `schoolId` from the JWT
// `@CurrentUser()` — body / query never accepted. Aligned with
// `TENANT_ISOLATION.md` and the assert-school-scope helper.
//
// Throttle profile: these endpoints don't poll (admin opens the page,
// reads, leaves). No special throttle bucket needed; default global
// limits apply.
// ============================================================================

@Controller('system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SystemController {
  constructor(
    private readonly backups: BackupStatusService,
    private readonly integrity: IntegrityCheckService,
  ) {}

  /**
   * Phase PLATFORM STABILIZATION Part 4 — surface "is the data safe?"
   * to school admins.
   *
   * Returns a flat `BackupHealth` shape derived from the platform-
   * level BackupService, with operator-internal fields (file paths,
   * sha256) stripped.
   */
  @Get('backup-status')
  getBackupStatus() {
    return this.backups.getHealth();
  }

  /**
   * Phase PLATFORM STABILIZATION Part 7 — integrity verification.
   *
   * Runs a fixed set of read-only checks against this tenant's data
   * and returns a structured `IntegrityReport`. Never mutates rows.
   *
   * Operators trigger this manually from the System Health page;
   * a future phase may add a daily cron + email digest, but that's
   * deliberately deferred (see STABILIZATION_DEFERRED.md).
   */
  @Get('integrity-report')
  getIntegrityReport(@CurrentUser() user: AuthenticatedUser) {
    return this.integrity.checkSchool(user.schoolId);
  }
}
