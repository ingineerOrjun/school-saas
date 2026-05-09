import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';
import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// MaintenanceModeGuard — Phase 17.
//
// Soft read-only gate. When a school's `maintenanceMode` flag is on:
//
//   • Mutating requests (POST / PATCH / PUT / DELETE) reject with
//     HTTP 503 + a clear message ("This school is in maintenance
//     mode. Reads are allowed; writes are paused.").
//   • Reads (GET / HEAD / OPTIONS) pass through.
//   • SUPER_ADMIN bypasses entirely — the operator who toggled
//     maintenance mode is the one finishing the work that prompted
//     it; they need writes.
//   • Unauthenticated requests skip the check (the auth layer rejects
//     them on its own; we don't probe maintenance for them).
//   • Platform-tier paths (`/platform/*`) skip the check — operator
//     console writes always work, regardless of any one tenant's
//     maintenance state.
//
// Why a guard (not middleware):
//   Guards run AFTER JwtAuthGuard so `req.user` is populated. A
//   middleware would have to re-decode the JWT or duplicate the
//   tenant lookup.
//
// Stack order:
//   @UseGuards(JwtAuthGuard, RolesGuard, MaintenanceModeGuard, ...)
//   The guard is registered globally via APP_GUARD so it runs on
//   every authenticated route without per-controller wiring.
// ---------------------------------------------------------------------------

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & {
      user?: AuthenticatedUser;
    }>();
    const user = req.user;

    // Unauthenticated → let the request continue. The auth layer
    // owns the rejection if needed; we don't pretend to know about
    // the tenant for anonymous traffic.
    if (!user) return true;

    // Read-only requests always pass.
    if (READ_METHODS.has(req.method)) return true;

    // SUPER_ADMINs bypass — they need writes during maintenance
    // sessions.
    if (user.role === Role.SUPER_ADMIN) return true;

    // Platform-tier routes are operator-only and bypass the gate
    // for the same reason as the SUPER_ADMIN bypass — writes there
    // are operator actions that are NEVER what maintenance mode
    // is meant to pause.
    if (req.path.startsWith('/platform')) return true;

    // Look up the tenant's maintenance state. Cheap (covered by
    // the schools_pkey index). A future optimization could cache
    // this per-user-id for the request's TTL, but the read is
    // already fast enough.
    const school = await this.prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { maintenanceMode: true },
    });
    if (!school) return true; // unknown tenant — let other layers decide
    if (!school.maintenanceMode) return true;

    // Maintenance is on AND this is a non-read request → reject.
    throw new HttpException(
      'This school is in maintenance mode. Reads are allowed; writes are paused. ' +
        'Contact your administrator if this is unexpected.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
