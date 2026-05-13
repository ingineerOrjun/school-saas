# Pre-Launch Checklist

_Last updated: 2026-05-13 — PILOT DEPLOYMENT phase, Part 6._
_Audience: the person who flips traffic on for the pilot school._
_Pair with: `SECURITY_REVIEW.md`, `PRODUCTION_DEPLOYMENT_CHECKLIST.md`, `PILOT_RISK_REGISTER.md`, `PERFORMANCE_RECON_REPORT.md`._

This is the go / no-go list. Every section MUST be green before the
pilot school's URL is shared. No item is optional. Items marked
**🛑 BLOCKER** stop launch until resolved.

## Section 1 — Code-level blockers (must be merged + deployed)

- [ ] **🛑 BLOCKER** CORS hardened with allowlist via `CORS_ORIGINS` env
      — see `SECURITY_REVIEW.md` §1
- [ ] **🛑 BLOCKER** Production `JWT_SECRET` rotated to a 32+ byte
      random value — see `SECURITY_REVIEW.md` §2
- [ ] **🛑 BLOCKER** Production database password is NOT `postgres` —
      see `SECURITY_REVIEW.md` §3
- [ ] **🛑 BLOCKER** No `.env` file on the production host —
      `[ ! -f /opt/scholaris/backend/.env ] && echo OK` returns OK
- [ ] **🛑 BLOCKER** Production `NEXT_PUBLIC_API_URL` points at the
      real API domain, not `localhost:3001`
- [ ] Helmet installed and applied in `main.ts` — see
      `SECURITY_REVIEW.md` §4
- [ ] Body-parser size limit set explicitly to 2 MB — see
      `SECURITY_REVIEW.md` §5

## Section 2 — Build + deploy state

- [ ] Backend `npm run build` ran on a CI runner; the resulting
      `dist/` was deployed (not built on the production host)
- [ ] Frontend `npm run build` ran on CI with production env vars
      baked in
- [ ] `npx prisma migrate deploy` ran successfully against the
      production database
- [ ] `npx prisma generate` ran during the build (verify the
      generated client matches the migrated schema)
- [ ] No `prisma migrate dev` was ever run against production

## Section 3 — Infrastructure

- [ ] TLS cert issued and auto-renewing on the production hostname
- [ ] `Strict-Transport-Security` header set at the proxy layer
- [ ] HTTP → HTTPS redirect enforced at the proxy
- [ ] `X-Forwarded-For` + `X-Forwarded-Proto` forwarded by the proxy
- [ ] Proxy `client_max_body_size` ≥ 2 MB (matches backend body parser)
- [ ] Process supervisor (PM2 / systemd) configured with:
  - [ ] auto-restart on crash
  - [ ] 30s SIGTERM grace period for `app.enableShutdownHooks()`
  - [ ] memory ceiling (e.g., 1 GB) with auto-recycle
  - [ ] stdout/stderr routed to log file or platform collector
- [ ] Liveness probe → `GET /health/live` (no auth)
- [ ] Readiness probe → `GET /health/ready` (DB probe)

## Section 4 — Database + backup readiness

- [ ] Production database is on managed Postgres OR a dedicated host
      with storage-layer backups (PITR if available)
- [ ] App user has SELECT/INSERT/UPDATE/DELETE on the app schema —
      NOT superuser
- [ ] `BACKUP_AUTOSTART` is NOT set to `false` in production env
- [ ] `BACKUP_ROOT_DIR` env points at a writable directory with
      adequate disk space (≥ 30 days × full-dump-size headroom)
- [ ] First on-demand backup post-deploy succeeded (verified via
      `/platform/operations/backups/run` + `BACKUP_ROOT_DIR` ls)
- [ ] Restore drill completed at least once against a staging DB
      (see `disaster-recovery.md` + `post-restore-verification.md`)
- [ ] Operator knows the exact restore command (`pg_restore --dbname=…
      --jobs=4 --no-owner --no-privileges …`)
- [ ] Operator knows where the backup artifacts live + how to verify
      sha256 (see `disaster-recovery.md` §2.2)

## Section 5 — Observability state

- [ ] `/health/live` returns 200 immediately
- [ ] `/health/ready` returns 200 (DB reachable)
- [ ] `/settings/system` Backups card shows last successful run
      within last 24h
- [ ] `/settings/system` Integrity card is "Clean" (or only INFO
      findings for legacy data — confirm none are `error` severity)
- [ ] `/platform/operations` `Overview` panel renders with no 5xx in
      the recent-errors panel
- [ ] Application log file exists + recent entries visible
- [ ] Operator knows where to look for `tx-telemetry` retry /
      exhaustion counters (operations cockpit Request panel)

## Section 6 — Tenant + identity

- [ ] Pilot school tenant created (one row in `schools`)
- [ ] Pilot school admin user created
- [ ] `schoolCode` value documented for the pilot school
- [ ] Admin login verified end-to-end (login → dashboard render →
      logout)
- [ ] No seed/test users remain (any `@example.com` accounts have
      been removed or are intentional super-admins)

## Section 7 — Operator readiness (the human side)

- [ ] Pilot school admin walked through `/onboarding` once during
      training session
- [ ] Pilot school admin received the welcome packet covering:
  - [ ] Glossary (archive vs lock vs deactivate — see
        `PILOT_RISK_REGISTER.md` R3)
  - [ ] Known limitations (cross-tab editing — R1)
  - [ ] Mobile/tablet tradeoffs (R4)
  - [ ] Refund + archive flows (R2)
- [ ] On-call engineer's contact info in the operator's hand
- [ ] On-call engineer has access to the operations cockpit
- [ ] Incident runbook (`OPERATOR_FAILURE_SCENARIOS.md`) shared with
      both sides

## Section 8 — Documentation

- [ ] `SECURITY_REVIEW.md` reviewed; all HIGH findings closed
- [ ] `PRODUCTION_DEPLOYMENT_CHECKLIST.md` walked through stage by stage
- [ ] `PILOT_RISK_REGISTER.md` shared with the operator
- [ ] `PERFORMANCE_RECON_REPORT.md` "Hot list" reviewed so the
      operator knows what to watch
- [ ] `disaster-recovery.md` + `post-restore-verification.md` printed
      or pinned in the on-call channel
- [ ] `CONCURRENCY_INVARIANTS.md` + `TRANSACTION_PATTERNS.md` known
      to engineering on-call

## Section 9 — Sanity checks (do these MANUALLY before sharing the URL)

Do not skip this section. Each item is fast.

- [ ] Open the public URL in an incognito window. See login page.
- [ ] Log in with the pilot admin. See dashboard.
- [ ] Create a class, a section, an academic session. Confirm they
      land in the audit feed.
- [ ] Create one test student. Archive. Restore. Audit feed shows
      `STUDENT_ARCHIVED` + `STUDENT_RESTORED`.
- [ ] Try to access another tenant's `/platform/schools/<other-id>`
      with a non-super-admin token — verify 404 (not 403).
- [ ] Spam-click the dashboard refresh 15 times. Confirm no 429
      (default bucket is 600/min/user; should not block).
- [ ] Try to log in with bad credentials 12 times in 60s. Confirm
      11th gets 429 (per-route override of 10/min).
- [ ] Open `/auth/register` (if exposed publicly) — confirm 5/hour
      throttling fires after 6 attempts. If not exposed, confirm the
      route is locked behind super-admin.
- [ ] Kill the backend process. PM2 / systemd restarts within 30s.
      Liveness probe goes red → green. Re-test login.

## Section 10 — Day-1 watch plan

Once traffic is live, the on-call engineer should:

- [ ] **Hour 0**: Confirm first 10 logins succeed; no 5xx in operations
      cockpit.
- [ ] **Hour 1**: Spot-check `/platform/operations` Request panel for
      slow-endpoint outliers.
- [ ] **Hour 4**: Verify `tx-telemetry` counters — any `retries > 0`
      indicates real contention.
- [ ] **End of day**: Check audit volume in `/audit/recent` — should
      reflect real school activity (creates, edits, attendance marks,
      payments).
- [ ] **Day 1 next morning**: Confirm the 03:00 UTC backup ran and
      shows up in `/settings/system`.
- [ ] **Day 2**: Run integrity report (`/settings/system`). Confirm
      Clean.
- [ ] **Day 3**: First "did anything surprise us?" debrief with the
      pilot school admin.

## Go / no-go decision

The pilot launches only when ALL of the following are true:

1. Every 🛑 BLOCKER in Section 1 is checked.
2. Every box in Sections 2-7 is checked.
3. Section 9 sanity checks all passed.
4. The on-call engineer is online and reachable.
5. The pilot school is expecting traffic to be enabled (don't
   surprise them).

If ANY of those are false: do not launch. Slip the date.

## What to do if launch goes wrong

- **First 30 minutes**: investigate via `/platform/operations`. If
  the issue is a single 5xx in one endpoint, log a runbook entry +
  let the operator hand the workaround to the pilot.
- **First 4 hours**: if the issue is sustained 5xx, throttle storms,
  or auth failures — pause traffic by removing the DNS entry (don't
  shut down the backend, which would block recovery). Communicate
  with the pilot school.
- **First 24 hours**: hard rollback = restore from the most-recent
  backup AND revert the deployed image to the previous tag. Don't
  partial-rollback database without code.

Roll forward over roll back when possible. A code redeploy with a
fix is almost always faster than a DB restore.
