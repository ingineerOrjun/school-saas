# Security Review — Pilot Deployment

_Last updated: 2026-05-13 — PILOT DEPLOYMENT phase, Part 1+2._
_Scope: static code review only. No live pentest, no SAST tool output._
_Audience: ops + the person who flips production traffic on._

This is the truthful security read going into pilot. Findings are
graded by **operational severity for a single-school pilot**, not by
generic OWASP weighting. Every finding cites a real file path.

## TL;DR — must-fix before pilot traffic

| # | Finding | Severity | File |
| --- | --- | --- | --- |
| 1 | CORS `enableCors` accepts every origin (reflects whatever the browser sends) | **HIGH** | `backend/src/main.ts:44-46` |
| 2 | `.env` shipped in working tree with `JWT_SECRET="dev-secret-change-me-in-production-…"` | **HIGH** | `backend/.env` |
| 3 | `docker-compose.yml` uses `POSTGRES_PASSWORD: postgres` | **HIGH** | `backend/docker-compose.yml` |
| 4 | No Helmet / security headers middleware | **MEDIUM** | `backend/src/main.ts` |
| 5 | No explicit body-parser size limit | **MEDIUM** | `backend/src/main.ts` |
| 6 | Cross-tab stale-write on student/exam edit dialogs (no ETag) | **MEDIUM (data-integrity)** | `frontend/components/students/EditStudentDialog.tsx` |
| 7 | Payment refund dialog lacks typed-confirm | **MEDIUM** | `frontend/components/fees/RefundPaymentDialog.tsx` |

Items 1-3 block pilot launch. Items 4-7 are pre-launch-week work.

## What's already in good shape (do NOT change)

These are passes the audit confirmed; the next contributor should NOT
"clean them up":

- **JWT secret loaded from env via `ConfigService.getOrThrow`** — fails
  fast at boot if missing. `backend/src/auth/auth.module.ts`.
- **`trust proxy: 1`** correctly set so `req.ip` reflects the real
  client behind nginx. `backend/src/main.ts:54`.
- **Global `ValidationPipe`** with `whitelist: true`, `transform: true`,
  `forbidNonWhitelisted: true`. Strips unknown DTO fields cleanly.
- **`AllExceptionsFilter`** never leaks stack traces to clients —
  client gets `{ statusCode, timestamp, path, message }` only; stack
  goes to server logs. `backend/src/common/filters/http-exception.filter.ts`.
- **Prisma errors translated to safe operator messages** (P2002, P2003,
  P2025) instead of leaking raw Prisma codes.
- **JWT auth via Authorization header only** — no cookies, no CSRF
  vector, no `secure: true` cookie traps on HTTPS termination.
- **Static `/uploads` serving** has `index: false` (no directory listing)
  and reasonable cache headers.
- **Throttler** keys per-user via `UserAwareThrottlerGuard` so one
  shared NAT doesn't starve other users.
- **429 throw policy** — `lib/api.ts` throws immediately on 429 (no
  retry storm).
- **Cross-tenant 404 invariant** — `assert-school-scope.ts` always
  returns `NotFoundException`, never `ForbiddenException`, preventing
  UUID enumeration.

## Findings — full detail

### 1. CORS reflects every origin (HIGH)

**File**: `backend/src/main.ts:44-46`

```ts
app.enableCors({
  exposedHeaders: ['Retry-After'],
});
```

`enableCors()` without an `origin` option uses the underlying Express
`cors` package default, which reflects whatever `Origin` header the
browser sent. For a server on `api.school.example` exposed to the
public internet, that means a malicious site `evil.example` can issue
authenticated requests against the API from a logged-in admin's
browser (since the JWT is in `Authorization`, not a cookie, this is
less catastrophic — but the API still leaks data to any origin a user
visits while logged in).

**Fix shape** (do NOT apply now — call it out so the operator does):

```ts
app.enableCors({
  origin: process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()),
  credentials: false,
  exposedHeaders: ['Retry-After'],
});
```

Plus add `CORS_ORIGINS=https://school.example,https://admin.school.example`
to the production env. **Block on pilot launch.**

### 2. Dev JWT secret in committed-on-disk `.env` (HIGH)

**File**: `backend/.env` (gitignored, so not in git history — but
present in the working tree and likely in any tarball / image build
done from this checkout).

```
JWT_SECRET="dev-secret-change-me-in-production-c7f4a9b2…"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scholaris"
```

This is the development secret. Anyone with read access to the host
sees it. If a deployment build is done from this directory without
overriding the env, the JWT_SECRET ships to production unchanged.

**Action**:
- Rotate `JWT_SECRET` to a cryptographically random 32-byte value.
- Inject env in production via the deployment platform, NOT via a
  committed `.env`.
- Update `backend/.env.example` to make it obvious the placeholder
  is a placeholder (it already says "change-me-in-production" but
  the actual `.env` should NOT carry that value verbatim).
- Verify no Docker image build copies `.env` into the image.

### 3. Default postgres credentials in `docker-compose.yml` (HIGH)

**File**: `backend/docker-compose.yml`

```yaml
environment:
  POSTGRES_USER: postgres
  POSTGRES_PASSWORD: postgres
  POSTGRES_DB: scholaris
```

If this compose file is ever used to bring up the pilot database
(intentionally or by accident), Postgres listens with default
credentials. Defence-in-depth: even on a private network, default
creds are a footgun.

**Action**:
- Move credentials to env vars referenced from compose
  (`POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}`).
- Document in README that pilot deployments do not use the bundled
  compose file (or if they do, the env must be set externally).

### 4. No Helmet / security headers (MEDIUM)

**File**: `backend/src/main.ts` — Helmet is not imported or applied.

Without Helmet:
- No `X-Frame-Options` → site clickjackable
- No `X-Content-Type-Options: nosniff`
- No `Referrer-Policy`
- No HSTS (must be set at TLS layer regardless — see deployment
  checklist)

**Fix shape**: `npm i helmet`, then in `main.ts` before
`enableCors`:

```ts
import helmet from 'helmet';
app.use(helmet());
```

Helmet's defaults are appropriate for a JSON API. Block on pilot
launch-week, not on first deploy (low active-exploit risk for a
single-school pilot on a known network).

### 5. No explicit body-parser size limit (MEDIUM)

**File**: `backend/src/main.ts`

`NestFactory.create(AppModule)` uses Express's default body-parser
limit of 100KB. Two consequences:
- CSV bulk-imports of student rosters could exceed 100KB on schools
  with 1000+ students and trip the default limit silently.
- Lack of an EXPLICIT limit makes it easy for a future PR to push
  the limit too high and open a memory-exhaustion DoS vector.

**Fix shape**: in `main.ts` immediately after `NestFactory.create`:

```ts
app.useBodyParser('json', { limit: '2mb' });
app.useBodyParser('urlencoded', { limit: '2mb', extended: true });
```

2 MB covers bulk imports up to ~10,000 students. Document in
`PRODUCTION_DEPLOYMENT_CHECKLIST.md`.

### 6. Cross-tab stale-write on edit dialogs (MEDIUM, data-integrity)

**File**: `frontend/components/students/EditStudentDialog.tsx` and
peer dialogs (`EditExamDialog`, class/section edit, etc.).

The dialog fetches the current student via React Query, but the form
state is local. If a principal opens Student A in Tab 1 and a teacher
opens Student A in Tab 2, edits in Tab 2, and Tab 1 then saves, Tab
1's stale form silently overwrites Tab 2's changes.

The backend has no `updatedAt`-based optimistic-concurrency check,
so the second write succeeds at the DB layer with no warning.

**Fix shape** (not in scope for pilot launch — flag as a P1
post-launch fix in `PILOT_RISK_REGISTER.md`):
- Include `updatedAt` in the edit-form payload.
- Backend `update()` does a conditional update: `where: { id, updatedAt }`.
- On `P2025` (record not found because `updatedAt` changed), surface
  a 409 with "this record was just changed elsewhere — refresh and
  retry."

Operational mitigation for the pilot: train admins to refresh before
editing, and emphasize that two operators editing the same student
simultaneously is a known limitation.

### 7. Payment refund missing typed-confirm (MEDIUM)

**File**: `frontend/components/fees/RefundPaymentDialog.tsx`

The refund dialog requires a reason (5+ chars) and shows a warning
banner but doesn't require the operator to type the receipt number
or amount. A fast-clicking cashier could refund the wrong receipt.

The student-archive flow already uses `ConfirmDestructiveActionDialog`
with typed-confirm; the refund flow should mirror that pattern.

**Fix shape**: wrap the destructive confirm in
`ConfirmDestructiveActionDialog` with `typedConfirmation: { label:
"Type the receipt number to confirm", expectedValue: payment.receiptNumber }`.

Block on pilot launch-week. Refunds are infrequent enough that this
isn't a day-one blocker, but it's the highest-blast-radius destructive
action in the cashier workflow.

## Items NOT flagged (verified safe)

- No unconditional `console.log` at module scope in backend src.
- No `/debug/*` endpoints remain (the throttler-debug surface was
  removed at the end of last phase).
- No Prisma `log: ['query']` enabled in production. The Prisma client
  is constructed with no `log` config, so no SQL leaks to stdout.
- No verbose logger override in `main.ts` that would log every
  request body.
- No 5+ minute `setInterval` polling. All `refetchInterval` calls
  poll at ≥ 20s (mostly 30-60s).
- React Query `retry: 1`, `refetchOnWindowFocus: false`,
  `refetchOnReconnect: true` — matches the documented governance.
- All `useQuery` calls gate on `useAuthReady()` to prevent
  anonymous-bursts before the JWT is in localStorage.
- 429 responses throw immediately (no retry — fixed last phase).

## SAST gaps (out of scope for this static review)

This document is a code-read, not a security tool run. Before public
exposure beyond the pilot school, the team should run at minimum:

- `npm audit` against backend + frontend lockfiles.
- A real SAST scan (Semgrep / Snyk Code / GitHub CodeQL on the repo).
- Dependency-confusion sweep for any non-public package names.
- TLS configuration scan (Qualys SSL Labs / `testssl.sh`) on the
  production endpoint once it's up.

These are LAUNCH-WEEK tasks, not authoring-time work.

## What "pilot ready" means after these findings

| Pilot phase | Required findings closed |
| --- | --- |
| First school onboarding (intranet only) | 1, 2, 3 |
| Public internet pilot (single school) | 1, 2, 3, 4, 5 |
| Second school added (multi-tenant production) | 1-7 + SAST sweep |

Don't ship past phase 1 without items 1-3 closed.
