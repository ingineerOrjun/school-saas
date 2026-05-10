import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { JobRunnerService } from './common/jobs/job-runner.service';
import { StartupDiagnosticsService } from './common/observability/startup-diagnostics.service';
import { StructuredLogger } from './common/observability/structured-logger';

async function bootstrap() {
  // Phase 22 — instantiate the structured logger BEFORE the Nest
  // bootstrap so the framework's own startup messages route through
  // it. Without this, the "Nest application started" line would still
  // be the colourised pretty printer in production.
  const logger = new StructuredLogger();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    // Phase 22 — opt into Nest's shutdown signals so onApplicationShutdown
    // fires for SIGTERM (containers / k8s) and SIGINT (Ctrl-C). Without
    // this, JobRunnerService's drain logic never gets to run.
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  // Replace the framework logger one more time to ensure DI-resolved
  // services use the same instance the bootstrap above used.
  app.useLogger(app.get(StructuredLogger));

  // Enable CORS.
  //
  // `exposedHeaders` lists response headers that JavaScript on the
  // browser side is allowed to READ via `res.headers.get(...)`. The
  // CORS spec only auto-exposes a small safelist (Cache-Control,
  // Content-*, Expires, Last-Modified, Pragma) — anything else is
  // present on the wire but invisible to fetch() callers without an
  // explicit Access-Control-Expose-Headers entry.
  //
  // `Retry-After` matters here: NestJS's ThrottlerGuard sets it on
  // every 429, and our api.ts retry loop relies on reading it to
  // skip retries when the server-indicated cooldown is longer than
  // ~5s. Without exposing it the value reads as null, the guard
  // never fires, and every 429 gets retried 3× — turning one logical
  // page-load 429 into four backend hits and amplifying throttle storms.
  app.enableCors({
    exposedHeaders: ['Retry-After'],
  });

  // Trust the first proxy hop so `req.ip` reflects the real client
  // when running behind nginx / a load balancer. Phase 9's rate
  // limiter + Phase 10's failed-login source-IP report both depend
  // on this — without it, every request appears to come from
  // 127.0.0.1 in production deployments. NestExpressApplication is
  // the typed way to reach the underlying Express knob.
  app.set('trust proxy', 1);

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Phase 10 — global exception filter is registered via APP_FILTER
  // in AppModule (so it can DI HealthService). No manual
  // useGlobalFilters needed here.

  // Phase 22 — startup diagnostics. Runs once after the module graph
  // is up (so we know if DB / queue / providers are healthy) and
  // emits a single structured "ready" line before listen(). If a
  // critical probe fails, this throws and the process exits non-zero
  // — k8s won't route traffic to a half-broken pod.
  await app.get(StartupDiagnosticsService).runOrExit();

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Application is running on port ${port}`);

  // Touch the runner so its onApplicationBootstrap fires (it's
  // already DI-registered, but accessing it here makes the boot
  // sequence explicit + visible in startup logs).
  app.get(JobRunnerService);
}

void bootstrap();
