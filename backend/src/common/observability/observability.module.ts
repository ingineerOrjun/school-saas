import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { RequestIdMiddleware } from './request-id.middleware';
import {
  RequestMetricsMiddleware,
  RequestMetricsService,
} from './request-metrics.middleware';
import { SchemaCheckService } from './schema-check.service';
import { StructuredLogger } from './structured-logger';

// ---------------------------------------------------------------------------
// ObservabilityModule — Phase α fix.
//
// Holds the cross-cutting observability primitives. Marked @Global()
// so any service in any feature module (Operations, Productization,
// future modules) can inject:
//
//   • RequestMetricsService — in-memory request ring buffer + windowed
//                              aggregations (Phase 19/20)
//   • StructuredLogger      — JSON logger; used by main.ts as the
//                              framework logger (Phase 22)
//
// The two middleware classes live here too because:
//   • Nest middleware uses DI — they must be in a module's providers
//     list to resolve their dependencies.
//   • Keeping them next to the service they consume avoids DI re-
//     wiring when the middleware grows.
//
// AppModule's `configure(consumer)` still references the middleware
// by class name — the @Global() registration makes them visible to
// the middleware consumer.
//
// Why this fix:
//   Originally `RequestMetricsService` lived as a plain provider on
//   AppModule. AppModule providers are NOT global — they only resolve
//   for AppModule's direct consumers. When `OperationsService` (in
//   `OperationsModule`) declared a `RequestMetricsService` constructor
//   parameter, Nest couldn't find a provider for it in the
//   OperationsModule's import graph and refused to start.
//
//   Tests didn't catch this because every service test mocks Prisma
//   + its other deps and instantiates the service directly without
//   the Nest DI container. Real boot exercises the full graph and
//   surfaced the bug immediately.
// ---------------------------------------------------------------------------

@Global()
@Module({
  // SchemaCheckService injects PrismaService — pull in DatabaseModule
  // explicitly so the @Global() registration here resolves cleanly.
  imports: [DatabaseModule],
  providers: [
    RequestMetricsService,
    StructuredLogger,
    RequestIdMiddleware,
    RequestMetricsMiddleware,
    SchemaCheckService,
  ],
  exports: [
    RequestMetricsService,
    StructuredLogger,
    RequestIdMiddleware,
    RequestMetricsMiddleware,
    SchemaCheckService,
  ],
})
export class ObservabilityModule {}
