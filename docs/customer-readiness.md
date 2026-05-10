# Customer Readiness Checklist

A live checklist for "is this deployment safe to put a real paying
school on?". Tick boxes are honest — only check what's verified,
not what's "should work."

---

## Schema + persistence

- [ ] `npx prisma migrate status` reports up-to-date
- [ ] Startup diagnostics shows `schema=ok(N critical columns present)` at boot
- [ ] No "missing column" warnings in the last 24h of logs

## Throttling + bootstrap

- [ ] No `user=<anon>` 429 lines in the throttle log on a fresh dashboard load
- [ ] Cold dashboard load fires ≤15 requests
- [ ] Dev `RequestPressurePanel` chip is grey (not amber) after 30s of normal usage
- [ ] No "We're slowing down requests" toasts during routine use

## Backup + restore

- [ ] Daily backup cron has produced ≥3 SUCCEEDED rows in `backup_runs`
- [ ] Most recent backup is <24h old
- [ ] `restore-runbook.md` has been **dry-run on a staging DB** by an operator
- [ ] Restore took <5 minutes for the school's data size
- [ ] Post-restore smoke verification passed (counts match)
- [ ] Operator has the restore command saved + tested OUTSIDE the dashboard

## Sessions + auth

- [ ] Login works
- [ ] Logout clears local state cleanly (no stale auth)
- [ ] Token expiry triggers `/login` redirect (not infinite spin)
- [ ] Session list (`/settings/sessions`) shows the active device
- [ ] Force-logout from `/platform/users/:id` actually evicts the user

## Maintenance mode

- [ ] Toggling on shows the maintenance banner to school users
- [ ] Writes return 503 with the configured message
- [ ] Reads continue to work
- [ ] SUPER_ADMIN bypasses
- [ ] Scheduled window auto-enables/disables at the configured times (verify with a near-future schedule)

## Notifications

- [ ] Bell badge shows correct unread count after marking read elsewhere (cross-tab)
- [ ] Polling cadence is 60s+ (check Network tab; should NOT see /unread-count fire every few seconds)
- [ ] Severity-tinted banners render for INCIDENT broadcasts

## Mobile

- [ ] Attendance roster loads + tap-to-toggle works on a real Android phone
- [ ] Fee collection 3-screen flow (pick → amount → success) works on a real phone
- [ ] Sync inspector page loads on mobile + retry button works
- [ ] Touch targets feel ≥44px (no missed taps on numeric pad)
- [ ] Bottom sheets don't conflict with the home indicator

## Offline

- [ ] Marking attendance offline → row appears in `/sync` queue
- [ ] Going back online drains the queue automatically (within 30s)
- [ ] Recording payment offline → same; receipt prints after sync
- [ ] Forcing a 409 (multi-device) → conflict surfaces in the inspector

## Operations cockpit

- [ ] `/platform/operations` loads without errors as SUPER_ADMIN
- [ ] All 9 sections render data
- [ ] Health card subsystem grid is mostly green
- [ ] Failed-jobs panel has <5 rows in the last 24h
- [ ] Dead-letter queue panel is empty (or has known reasons for the rows present)

## Deployment diagnostics

- [ ] `/platform/deployment` shows correct version + build timestamp
- [ ] Migration count matches what's in `prisma/migrations/`
- [ ] Upgrade-safety report is all-green (no `block` checks)

## Throttle + governance

- [ ] No endpoint polled more aggressively than 30s (besides notifications/unread-count at 60s)
- [ ] No `invalidateQueries({})` warnings in the dev console
- [ ] `PERFORMANCE_GOVERNANCE.md` rules table matches actual code

## Logs

- [ ] No `[5xx]` lines in the last 24h of `RequestMetrics` logs
- [ ] No "Health DB probe failed" warnings
- [ ] No "stuck-job-sweeper unlocked" alerts in the last 24h
- [ ] Structured log lines include `requestId` for every request

## End-to-end smoke

Walk through these flows manually and tick each step:

1. **New tenant onboarding**:
   - [ ] Register a new school via /register
   - [ ] Onboarding wizard appears at /onboarding
   - [ ] Each step ticks as you complete it
   - [ ] Mark complete → dashboard loads

2. **Daily attendance**:
   - [ ] Teacher opens /attendance, picks a class
   - [ ] Roster loads (cached after first time)
   - [ ] Mark all present → all rows turn green
   - [ ] Refresh page → marks persist
   - [ ] Toggle one absent → re-renders correctly
   - [ ] Sync indicator shows "synced" within 5s

3. **Cashier flow** (mobile):
   - [ ] Pick student via search
   - [ ] Enter amount on numeric pad
   - [ ] Tap method (Cash)
   - [ ] Tap charge → success screen with ✓
   - [ ] Print/share row works

4. **Operator support**:
   - [ ] Pull up `/platform/schools/:id`
   - [ ] Add a support note
   - [ ] Force-logout one user
   - [ ] Confirm via session inspector

---

## Known gaps (deferred)

- Per-tenant point-in-time restore (full-DB restore only)
- Cross-region backup shipping (single-host backups only)
- Real-device mobile QA on low-end Android (text-edited, not run)
- 8-hour long-session reliability (needs runtime test)
- Profiled rerender chains (needs React DevTools session)

These are NOT showstoppers for a first paying customer, but they're
the next things to address as the customer base grows.

---

## Sign-off

Before going live with paid traffic, two people should sign:

- [ ] **Engineering** (the person who can debug at 2am): _______
- [ ] **Operations** (the person whose phone rings if it breaks): _______

Date: _________
School: _________
