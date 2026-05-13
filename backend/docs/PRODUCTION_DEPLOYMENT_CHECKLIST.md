# Production Deployment Checklist

_Last updated: 2026-05-13 — PILOT DEPLOYMENT phase, Part 1._
_Audience: the engineer/operator pushing pilot traffic._
_Pair with: `SECURITY_REVIEW.md` (findings detail), `PRE_LAUNCH_CHECKLIST.md` (go/no-go)._

This is the deploy-day playbook. Steps are ordered by execution; tick
each one before proceeding to the next. **Do not skip steps.** Where
a step requires a code change, the fix shape is referenced into
`SECURITY_REVIEW.md` — the change must be a PR + review + merge,
never an in-place edit on the production host.

## Stage 1 — Environment & secrets (BEFORE first deploy)

- [ ] **JWT_SECRET rotated**. Generate a fresh value:
      `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
      Inject via the production env. Do NOT commit. (SECURITY_REVIEW.md §2)
- [ ] **DATABASE_URL set** to the production Postgres connection string.
      Confirm the user has the minimum-required permissions
      (SELECT/INSERT/UPDATE/DELETE on the app schema; NO superuser).
- [ ] **No `.env` file present on the production host.** Env is injected
      by the deployment platform (PM2 ecosystem / systemd / Docker
      env-file / k8s secret). Verify:
      `[ ! -f /opt/scholaris/backend/.env ] && echo OK`.
- [ ] **`backend/.env.example` reviewed** — every required var
      documented with a non-secret placeholder.
- [ ] **CORS_ORIGINS env set** to the allowlisted domains (comma-
      separated). Example: `CORS_ORIGINS=https://school.example`.
- [ ] **APP_URL env set** to the public frontend URL (used in
      transactional emails + receipt verification QR codes).
- [ ] **NEXT_PUBLIC_API_URL set** on the frontend deployment platform
      to `https://api.school.example`. Never localhost in production.
- [ ] **PORT env set** (default 3000). Match what the reverse proxy
      forwards to.

## Stage 2 — Code-level production hardening (BEFORE first deploy)

These require code changes — each must be a PR. See
`SECURITY_REVIEW.md` for the exact fix shapes.

- [ ] **CORS hardened** — `app.enableCors({ origin: …, … })` references
      `CORS_ORIGINS` env. (§1)
- [ ] **Helmet installed and applied** in `main.ts`. (§4)
- [ ] **Body-parser size limit set** to 2 MB. (§5)
- [ ] **Optional**: payment refund typed-confirm added. (§7 — can defer
      one week post-launch)

After PR merge, rebuild + redeploy.

## Stage 3 — Database

- [ ] **Production database created** on managed Postgres or a
      dedicated host. Backups enabled at the storage layer (PITR if
      available).
- [ ] **Migrations applied**:
      `DATABASE_URL=… npx prisma migrate deploy` — not `migrate dev`
      (which would generate new files).
- [ ] **`prisma generate`** ran during the production build (CI step,
      not on the host).
- [ ] **Seed data NOT applied in production**. The seed script is
      for dev only.
- [ ] **`BackupService` cron verified**: `BACKUP_AUTOSTART` is not
      `false` in production env. First scheduled run lands within
      24h.
- [ ] **`BACKUP_ROOT_DIR` set** to a path with adequate disk + write
      permission for the application user.
- [ ] **Trigger one on-demand backup** post-deploy via
      `POST /platform/operations/backups/run` and verify a `.dump`
      artifact lands at `BACKUP_ROOT_DIR`.
- [ ] **Restore drill** — at least one practice restore against a
      staging DB before pilot traffic. See `disaster-recovery.md` +
      `post-restore-verification.md`.

## Stage 4 — Reverse proxy + TLS

Reverse proxy (nginx, Caddy, or platform-managed) terminates TLS
before traffic reaches the Nest backend. The backend expects this
arrangement and does NOT terminate TLS itself.

- [ ] **TLS cert issued** (Let's Encrypt / managed). Verify with
      `curl -vI https://api.school.example` returns HTTP 200 from the
      health endpoint.
- [ ] **HSTS header** set at the proxy layer (do NOT rely on Helmet
      alone). Recommended:
      `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- [ ] **HTTP → HTTPS redirect** at the proxy. Backend does not redirect.
- [ ] **`X-Forwarded-For` and `X-Forwarded-Proto`** forwarded by the
      proxy. The backend trusts the first proxy hop (`trust proxy: 1`
      in `main.ts:54`) — verify the proxy is configured as a SINGLE
      hop, not a chain that would let a malicious client spoof its IP.
- [ ] **Client-body size limit** at the proxy ≥ 2 MB (matching
      the app body-parser). Default nginx is 1 MB — must be raised.
      Example: `client_max_body_size 2m;`.
- [ ] **Upload directory** (`/uploads/*`) — confirm the proxy passes
      through to the backend (the backend serves these via
      ServeStaticModule). Alternatively, serve from the proxy directly
      for performance — but then ensure the proxy also enforces
      `index off;`.
- [ ] **Throttling** — do NOT add a second rate limiter at the proxy
      that could double-count and cause false 429s. The app's own
      throttler is the source of truth.

## Stage 5 — Process manager (PM2 or systemd)

PM2 is the simplest path; systemd works equally well. **No
`Dockerfile` is currently shipped** — deployment is a `node dist/main`
process supervised by PM2 / systemd.

- [ ] **`npm run build`** completed against the production
      `NODE_ENV=production`.
- [ ] **Process supervisor configured** with auto-restart, log rotation,
      and graceful shutdown (SIGTERM). The app calls
      `app.enableShutdownHooks()` so drain logic runs on SIGTERM —
      give the supervisor a 30s shutdown grace.
- [ ] **Memory limit** set on the supervisor (e.g., PM2's
      `max_memory_restart: '1G'`) so a runaway process recycles.
- [ ] **stdout/stderr** routed to a file or platform log collector.
      The app uses `StructuredLogger` which emits JSON in production
      (gated on `LOG_FORMAT=json` env if not the default).
- [ ] **Health probes** point at `GET /health/live` (no auth, no
      throttle, no DB hit) for liveness; `GET /health/ready` (DB probe)
      for readiness. Both exist + are documented at
      `backend/src/health/health.controller.ts`.

## Stage 6 — Frontend

- [ ] **`npm run build`** of the Next.js app on a CI runner.
- [ ] **Environment vars** baked into the build:
      - `NEXT_PUBLIC_API_URL=https://api.school.example`
      - (no other public env vars needed today)
- [ ] **Frontend hosting** — Vercel / Cloudflare Pages / nginx + the
      `out/` directory work equally well. Static + SPA hydration.
- [ ] **CDN cache rules** — long max-age on `/static/*`, no-cache on
      `/`. The Next.js build configures this automatically; verify
      with `curl -I` on a few representative URLs.

## Stage 7 — First-boot smoke test

After traffic is enabled:

- [ ] `curl https://api.school.example/health/live` → `200 { "status": "ok" }`
- [ ] `curl https://api.school.example/health/ready` → `200` and the
      DB probe succeeds.
- [ ] Open the frontend, log in as the seed admin. Successful login
      lands on /dashboard.
- [ ] Visit `/settings/system`. Backups card shows the most-recent
      successful run. Integrity card is Clean (or only INFO findings
      for legacy data).
- [ ] Open `/platform/operations` as SUPER_ADMIN. Verify no recent
      `error`-severity rows.
- [ ] Trigger one on-demand backup. Verify it succeeds within ~30
      seconds and lands in `BACKUP_ROOT_DIR`.

## Stage 8 — Pilot-school onboarding

- [ ] **Tenant provisioned** via `POST /auth/register-admin` (or
      manual seed). One admin user, one school row.
- [ ] **`schoolCode` shared with the pilot school** through a
      secure channel (NOT email plaintext if you can avoid it).
- [ ] **Admin walks the onboarding wizard** (`/onboarding`) — school
      profile, classes, sessions, fee structures, staff invitations.
- [ ] **Pilot-school contact** documented in operator notes:
      who to call when the dashboard shows red.

## Stage 9 — Post-launch observability (first 48 hours)

- [ ] **Hourly check** of `/platform/operations/health` + the
      `recent failures` panel. Investigate any 5xx.
- [ ] **Daily check** of `/settings/system` (backup freshness +
      integrity report).
- [ ] **Daily check** of the audit feed (`/audit/recent`) for
      unexpected `*_ARCHIVED` / `MARKS_LOCKED` / `PROMOTION_EXECUTED`
      events.
- [ ] **Cron run confirmation** — the daily backup cron fires at
      03:00 UTC; verify the next two runs land successfully.

## Non-negotiables

- **Do not skip Stages 1-3.** Each item is genuinely required for
  pilot operation.
- **Do not run `migrate dev` against production**. It would generate
  migration files in the production checkout that don't match the
  team's repo.
- **Do not edit code on the production host**. Always PR + redeploy.
- **Do not disable the throttler** to "fix" a 429 issue at runtime.
  See `OPERATOR_FAILURE_SCENARIOS.md` for the right remediation.
- **Do not commit `.env`**. The `.gitignore` covers it; if a future
  PR removes the entry, block it.
