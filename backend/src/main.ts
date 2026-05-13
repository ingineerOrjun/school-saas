import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
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

  // ---- Helmet security headers (Phase FINAL-HARDENING Part 1). ----
  // Defaults are appropriate for a JSON API: X-Content-Type-Options,
  // X-Frame-Options: SAMEORIGIN, Referrer-Policy, Cross-Origin-* etc.
  // We DISABLE the default Content-Security-Policy because this
  // backend serves JSON only — the CSP shipped by Helmet by default
  // is tuned for HTML responses and would surface noisy reports
  // without protecting anything (CSPs on JSON are inert). The CSP
  // for the FRONTEND is set by the Next.js host (Vercel / nginx).
  // HSTS is set at the TLS-termination proxy, not here.
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  // ---- CORS allowlist (Phase FINAL-HARDENING Part 1). ----
  //
  // The previous configuration omitted `origin` entirely, which made
  // the underlying Express `cors` package REFLECT every request
  // origin — a logged-in admin browsing any malicious page would
  // leak data to that page's origin via fetch().
  //
  // Production allowlist is sourced from FRONTEND_URL (comma-
  // separated list, trimmed). Localhost is allowed ONLY in dev so
  // the dev workflow (`npm run dev`) still works without env wiring.
  //
  // `Retry-After` stays in `exposedHeaders` so the frontend's 429
  // path can read the server-indicated cooldown. `credentials: true`
  // is set per spec even though we don't currently use cookies — it
  // costs nothing and forward-compats with a possible cookie-based
  // session add later.
  const corsOrigins = resolveCorsOrigins();
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    exposedHeaders: ['Retry-After'],
  });

  // Trust the first proxy hop so `req.ip` reflects the real client
  // when running behind nginx / a load balancer. Phase 9's rate
  // limiter + Phase 10's failed-login source-IP report both depend
  // on this — without it, every request appears to come from
  // 127.0.0.1 in production deployments. NestExpressApplication is
  // the typed way to reach the underlying Express knob.
  app.set('trust proxy', 1);

  // ---- Body-parser size limits (Phase FINAL-HARDENING Part 1). ----
  // Express default is 100 KB which silently rejects bulk CSV imports
  // for schools with 1000+ students. 2 MB covers ~10k rows while
  // remaining well below a memory-DoS vector. The reverse-proxy
  // (nginx) `client_max_body_size` must match (see
  // PRODUCTION_DEPLOYMENT_CHECKLIST.md Stage 4).
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });

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

/**
 * Resolve the CORS origin policy from environment variables.
 *
 *   • Production:  `FRONTEND_URL` is required. Comma-separated for
 *                  multiple origins. Anything else is rejected.
 *                  Missing env → fail fast (boot will hard-stop).
 *   • Development: localhost on common dev ports is allowed in
 *                  addition to anything `FRONTEND_URL` specifies, so
 *                  `npm run dev` works without env wiring.
 *
 * The returned value is consumed by `app.enableCors({ origin: … })`.
 * Returning an array makes the `cors` package match exactly; returning
 * a callback would allow per-request inspection, but the array form
 * is sufficient for this surface and keeps the policy auditable.
 */
function resolveCorsOrigins(): string[] {
  const raw = process.env.FRONTEND_URL ?? '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (process.env.NODE_ENV === 'production') {
    if (fromEnv.length === 0) {
      // Hard fail rather than silently reflecting "no origins" (which
      // would block legitimate frontend traffic). StartupDiagnostics
      // catches this earlier, but the bare config layer is defensive.
      throw new Error(
        'FRONTEND_URL is required in production. ' +
          'Set it to the comma-separated list of allowed origins ' +
          '(e.g. "https://school.example,https://admin.school.example") ' +
          'before starting the server.',
      );
    }
    return fromEnv;
  }

  // Development — always allow localhost on the common dev ports so
  // a fresh checkout works without env setup. Operator-supplied
  // FRONTEND_URL still merges in for staging-like setups.
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    ...fromEnv,
  ];
}

void bootstrap();
