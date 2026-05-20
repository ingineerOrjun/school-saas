import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';

// ============================================================================
// Module-boot smoke test — Session 6c.3 follow-up.
//
// Why this exists:
//
// In Session 6c.3 the TeacherModule started injecting UserService, but
// UserModule was missing `exports: [UserService]`. Every existing unit
// test passed (they use TestingModule fixtures that bypass real module
// wiring), and the bug only surfaced at `npm run start:dev` boot with
// an UnknownDependenciesException — i.e., a place humans noticed but
// CI did not.
//
// What this test does:
//
//   • Calls `Test.createTestingModule({ imports: [AppModule] }).compile()`.
//   • `compile()` walks the FULL module graph and resolves every
//     provider's dependencies. If any cross-module `imports: [X]`
//     consumer asks for a provider X didn't `exports:`, the compile
//     throws UnknownDependenciesException — failing the test instead
//     of the dev server.
//   • `compile()` deliberately does NOT call lifecycle hooks
//     (`onModuleInit`), so PrismaService's `$connect()` never runs.
//     The test is therefore DB-independent: it validates the DI graph
//     without booting the app.
//
// What this test does NOT catch:
//
//   • Runtime errors inside controllers / handlers.
//   • Lifecycle errors that only manifest at `init()` time
//     (DB connectivity, queue startup, etc.).
//   • Type-level mismatches that tsc already catches.
//
// PrismaService is overridden to a no-op so the test runs without a
// database. The constructor on the real PrismaService extends
// PrismaClient — instantiating it dry is harmless (no network), but
// the override is defensive in case the upstream Prisma client adds
// eager connection logic in its constructor.
// ============================================================================

describe('Module boot', () => {
  it('AppModule resolves every provider (catches missing `exports` across modules)', async () => {
    const stubPrisma = {
      onModuleInit: async () => undefined,
      onModuleDestroy: async () => undefined,
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      // Any model accessor read during constructor-time provider
      // resolution would surface here. None of the providers in this
      // codebase touch `prisma.foo.findX()` from a constructor —
      // domain reads live in methods, so the stub doesn't need to
      // model the Prisma model surface to satisfy `compile()`.
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(stubPrisma)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
