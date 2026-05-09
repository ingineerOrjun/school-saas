import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MaintenanceModeGuard } from './maintenance-mode.guard';
import type { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// MaintenanceModeGuard — Phase 17 tests.
//
// The guard is a small piece of glue but the routing rules MATTER —
// every assertion below maps to a security or product requirement
// the spec calls out:
//
//   • Read-only methods (GET / HEAD / OPTIONS) always pass, even in
//     maintenance — schools should still be able to look at their
//     data while writes are paused.
//   • SUPER_ADMIN bypasses entirely. Operator must be able to write
//     during a maintenance session (that's why they enabled it).
//   • Platform-tier paths (/platform/*) bypass — operator console
//     writes are never the thing maintenance is meant to pause.
//   • Unauthenticated requests pass — JwtAuthGuard owns rejection
//     for those; this guard doesn't second-guess.
//   • A POST on a maintenance-on tenant from a normal user → 503.
//   • A POST on a maintenance-OFF tenant → pass.
//   • Unknown school (deleted between auth + here) → pass; other
//     layers reject.
// ---------------------------------------------------------------------------

interface MockReq {
  method: string;
  path: string;
  user?: { id: string; role: Role; schoolId: string };
}

function buildContext(req: MockReq): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function buildHarness(opts: { maintenanceMode?: boolean | null } = {}) {
  const { maintenanceMode = false } = opts;
  const prisma = {
    school: {
      findUnique: jest.fn(async () =>
        maintenanceMode === null ? null : { maintenanceMode },
      ),
    },
  } as unknown as PrismaService;
  const guard = new MaintenanceModeGuard(prisma);
  return { guard, prisma };
}

describe('MaintenanceModeGuard', () => {
  describe('passes through', () => {
    it('lets unauthenticated requests through (other guards own the rejection)', async () => {
      const h = buildHarness({ maintenanceMode: true });
      const ctx = buildContext({ method: 'POST', path: '/students' });
      await expect(h.guard.canActivate(ctx)).resolves.toBe(true);
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'lets %s requests through even when maintenance is on',
      async (method) => {
        const h = buildHarness({ maintenanceMode: true });
        const ctx = buildContext({
          method,
          path: '/students',
          user: { id: 'u-1', role: Role.ADMIN, schoolId: 's-1' },
        });
        await expect(h.guard.canActivate(ctx)).resolves.toBe(true);
      },
    );

    it('lets SUPER_ADMIN write through, even when maintenance is on', async () => {
      const h = buildHarness({ maintenanceMode: true });
      const ctx = buildContext({
        method: 'POST',
        path: '/students',
        user: { id: 'super-1', role: Role.SUPER_ADMIN, schoolId: 's-platform' },
      });
      await expect(h.guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('lets writes to /platform/* through (operator console)', async () => {
      const h = buildHarness({ maintenanceMode: true });
      const ctx = buildContext({
        method: 'POST',
        path: '/platform/schools/s-1/force-logout',
        user: { id: 'super-1', role: Role.SUPER_ADMIN, schoolId: 's-platform' },
      });
      await expect(h.guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('passes when the tenant is NOT in maintenance', async () => {
      const h = buildHarness({ maintenanceMode: false });
      const ctx = buildContext({
        method: 'POST',
        path: '/students',
        user: { id: 'u-1', role: Role.ADMIN, schoolId: 's-1' },
      });
      await expect(h.guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('passes when the school row is missing (other layers reject)', async () => {
      const h = buildHarness({ maintenanceMode: null });
      const ctx = buildContext({
        method: 'POST',
        path: '/students',
        user: { id: 'u-1', role: Role.ADMIN, schoolId: 's-vanished' },
      });
      await expect(h.guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('rejects', () => {
    it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
      'rejects %s on a maintenance-on tenant from a normal user with 503',
      async (method) => {
        const h = buildHarness({ maintenanceMode: true });
        const ctx = buildContext({
          method,
          path: '/students',
          user: { id: 'u-1', role: Role.ADMIN, schoolId: 's-1' },
        });
        await expect(h.guard.canActivate(ctx)).rejects.toBeInstanceOf(
          HttpException,
        );
        try {
          await h.guard.canActivate(ctx);
        } catch (e) {
          expect((e as HttpException).getStatus()).toBe(
            HttpStatus.SERVICE_UNAVAILABLE,
          );
          expect((e as HttpException).message).toContain('maintenance mode');
        }
      },
    );

    it('rejects TEACHER writes too, not just ADMIN', async () => {
      const h = buildHarness({ maintenanceMode: true });
      const ctx = buildContext({
        method: 'POST',
        path: '/attendance',
        user: { id: 'u-2', role: Role.TEACHER, schoolId: 's-1' },
      });
      await expect(h.guard.canActivate(ctx)).rejects.toBeInstanceOf(
        HttpException,
      );
    });
  });
});
