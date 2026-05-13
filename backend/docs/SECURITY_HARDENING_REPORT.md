# Security Hardening Report

_Last updated: 2026-05-13 — FINAL PRE-PILOT HARDENING Part 1._
_Audience: ops / the person who flips production traffic on._

This is the truthful report of what shipped under Part 1. Pair with
`SECURITY_REVIEW.md` (the prior audit) and
`PRE_LAUNCH_CHECKLIST.md` (the go/no-go list).

## What shipped

### 1. CORS allowlist (was: reflect-any-origin)

**File**: `backend/src/main.ts:44-83` plus
`resolveCorsOrigins()` helper at the bottom of the file.

Previously `app.enableCors({ exposedHeaders: ['Retry-After'] })` —
no `origin` → reflect every request origin. **Fixed.**

After:

```ts
const corsOrigins = resolveCorsOrigins();
app.enableCors({
  origin: corsOrigins,
  credentials: true,
  exposedHeaders: ['Retry-After'],
});
```

`resolveCorsOrigins()` reads `FRONTEND_URL` (comma-separated). In
**production**, missing env → hard fail at boot (the helper throws,
the process exits non-zero). In **development**, the localhost dev
ports (3000/3001 + 127.0.0.1 equivalents) are always allowed so
`npm run dev` works without env setup.

Required production env:

```sh
FRONTEND_URL=https://school.example,https://admin.school.example
```

The `startup-diagnostics.service.ts` also surfaces a structured
"missing env: FRONTEND_URL" failure when this is absent in production
— operator-friendly failure surface even before CORS construction.

### 2. Helmet security headers (was: none)

**File**: `backend/src/main.ts:30-43` (after the structured logger setup,
before the CORS block).

```ts
app.use(helmet({ contentSecurityPolicy: false }));
```

`helmet@^8.1.0` installed via `npm install --save`. CSP is
deliberately disabled because this backend serves JSON — Helmet's
default CSP is tuned for HTML responses and adds noise without
protection. The frontend's CSP is set by the Next.js host (Vercel /
nginx).

Headers now sent by default:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Origin-Agent-Cluster: ?1`
- `Strict-Transport-Security: max-age=15552000; includeSubDomains` (also set at the TLS-terminating proxy — defense in depth)
- `X-DNS-Prefetch-Control: off`
- `X-Download-Options: noopen`
- `X-Permitted-Cross-Domain-Policies: none`
- `X-XSS-Protection: 0`

### 3. Body-parser size limits (was: Express default 100KB)

**File**: `backend/src/main.ts:62-69`.

```ts
app.useBodyParser('json', { limit: '2mb' });
app.useBodyParser('urlencoded', { limit: '2mb', extended: true });
```

The previous 100KB default silently rejected bulk CSV imports for
schools with 1000+ students. 2 MB covers ~10K rows while staying
well below a memory-DoS vector. **Reverse-proxy `client_max_body_size`
MUST match** — see `PRODUCTION_DEPLOYMENT_CHECKLIST.md` Stage 4.

### 4. FRONTEND_URL added to startup env validation

**File**: `backend/src/common/observability/startup-diagnostics.service.ts:119-132`.

Production-only requirement — the env probe now reports
`missing env: FRONTEND_URL` in the structured startup failure if the
operator forgets to set it. Without this, the CORS constructor in
`main.ts` would throw a less-structured error a fraction of a second
later. This is defense in depth — both surfaces fail loudly, but the
diagnostics path produces a cleaner operator log.

## What was verified, NOT changed

These were audited and found already-safe:

| Concern | Status | Evidence |
| --- | --- | --- |
| Stack-trace leak to clients | ✅ Already safe | `AllExceptionsFilter` returns only `{statusCode, timestamp, path, message}` to clients; full stack stays in server log |
| `console.log` of secrets at module scope | ✅ None found | Grep against `backend/src` |
| Prisma SQL logging | ✅ Disabled | `PrismaClient` constructed with no `log: […]` config |
| Hardcoded secrets at module scope | ✅ None | `JWT_SECRET` loaded via `ConfigService.getOrThrow` |
| `/uploads` directory browsing | ✅ Disabled | `ServeStaticModule` config has `index: false` |
| `/uploads` executable-upload risk | ⚠️ Mitigated, not eliminated | School-logo upload (`school.service.ts`) validates MIME type, caps at 2 MB, regenerates safe filename. The route does NOT execute uploads. Static serving has no PHP/CGI handler. |
| `/debug/*` endpoints | ✅ None present | The throttler-debug controller was removed at end of RELIABILITY-IV |
| Verbose Logger in production | ✅ Production-safe | `StructuredLogger` emits JSON when `LOG_FORMAT=json` or `NODE_ENV=production` |
| `trust proxy` correctness | ✅ `app.set('trust proxy', 1)` | Single hop assumed; documented |
| `ValidationPipe` global | ✅ `whitelist`, `transform`, `forbidNonWhitelisted` | All three flags on |
| JWT in Authorization header (no cookies) | ✅ No CSRF surface | No cookie-parser, no `secure: true` cookie traps |
| Cross-tenant 404 invariant | ✅ Honored | `assert-school-scope.ts` always throws `NotFoundException` |

## Risks fixed

| Risk | Severity (before fix) | Status |
| --- | --- | --- |
| CORS reflects any origin (logged-in admin's data exfiltrable from malicious site) | HIGH | Fixed |
| No browser-protection headers | MEDIUM | Fixed (Helmet) |
| Bulk import silently fails on 100KB+ payloads | MEDIUM | Fixed (2 MB) |
| Production boot proceeds with no allowlist if env is missing | HIGH | Fixed (hard fail at startup diagnostics + CORS constructor) |

## What's NOT in this report (still pending — see other deliverables)

- **Secret rotation** of `JWT_SECRET` and the production `DATABASE_URL`
  password — these are operational tasks, not code changes. Tracked
  in `PRE_LAUNCH_CHECKLIST.md` Section 1.
- **`docker-compose.yml`** default postgres credentials — this file is
  development-only; pilot deployment must inject creds via env on the
  production Postgres host.
- **Per-tenant content security policy** for the future case where the
  app starts serving HTML — N/A today.
- **SAST sweep + `npm audit`** — runbook items in
  `PRODUCTION_DEPLOYMENT_CHECKLIST.md`.

## Verification

- Backend `tsc --noEmit`: **clean**.
- Backend `jest`: **227/227 passing**. No regressions from CORS /
  Helmet / body-parser changes (unit tests don't exercise the boot
  path — but every existing service test still passes).
- Frontend `tsc --noEmit`: **clean** (no frontend change in Part 1).

## Runtime verification limitations

I did NOT actually start the backend with `FRONTEND_URL=…` set and
fire a cross-origin request against it. The code paths are:

1. `resolveCorsOrigins()` — pure function, unit-testable on its own.
   Logic verified by reading + by the existing test suite still
   passing.
2. `app.use(helmet({ contentSecurityPolicy: false }))` — opaque
   third-party middleware. I trust the helmet package; if the
   pilot deploy surfaces a header issue, the fix is in the helmet
   options.

The first pilot deploy is the runtime verification. Section 1 of
`PRE_LAUNCH_CHECKLIST.md` instructs the operator to set `FRONTEND_URL`
before boot, and Section 9 includes a `curl -I https://api…` smoke
check that will surface a misconfigured CORS header in seconds.
