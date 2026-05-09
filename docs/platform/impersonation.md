# Impersonation Safety

How a `SUPER_ADMIN` signs in as a school user without weakening the
audit trail or opening lateral-movement paths.

## What impersonation IS

A platform owner can click "Sign in as <user>" on any school's user
list. The backend mints a fresh JWT carrying the TARGET user's
identity (not the SUPER_ADMIN's). For the duration of the session,
domain code sees the SUPER_ADMIN as if they were the target — same
role, same school, same per-class teacher scope.

This solves real support cases:
- "An admin reports the students screen is broken" — operator
  reproduces from the admin's POV.
- "A teacher's marks aren't saving" — operator opens the same
  screen the teacher sees.

## What impersonation is NOT

- **Not a way to bypass audit.** Every start + end records to
  `platform_audit_events` with the SUPER_ADMIN as actor, the target
  as target, the school name in the label, IP + user-agent.
- **Not a way to act as another SUPER_ADMIN.** Hard refusal at
  service + controller layers.
- **Not a way to act as yourself.** Self-impersonation rejected.
- **Not nestable.** Starting impersonation while already
  impersonating is rejected. Otherwise the audit trail can't
  answer "who actually ran this write?"
- **Not a way to enter a SUSPENDED / EXPIRED tenant.** Same login
  gate the school admin would hit. The fix is to reactivate the
  school first (which is its own audited action).

## The token shape

A normal JWT:
```json
{
  "userId": "u-1",
  "role": "ADMIN",
  "schoolId": "s-1",
  "iat": 1234567890,
  "exp": 1234654290
}
```

An impersonation JWT carries TWO extra sentinels:
```json
{
  "userId": "u-1",          // target's id
  "role": "ADMIN",          // target's role
  "schoolId": "s-1",        // target's school
  "impersonatedBy": "super-1",
  "impersonationStartedAt": "2026-05-09T10:00:00Z",
  "iat": 1234567890,
  "exp": 1234654290
}
```

Domain code doesn't read `impersonatedBy` — it sees a normal target
session. ONLY platform code (the banner, audit ingestion, the rule
that rejects impersonated requests on `/platform/*`) reads it.

## Audit attribution

Writes performed during impersonation are attributed to the TARGET
user in domain audit columns (`createdById` on payments, etc.).
That's intentional:

- The point of impersonation is reproducing what the school admin
  sees + does. Backdating writes to the SUPER_ADMIN would make the
  school's own audit trail incoherent.
- The platform-side `IMPERSONATION_STARTED` and
  `IMPERSONATION_ENDED` events bracket every write the
  SUPER_ADMIN made. The combination tells a complete story:
  - Domain audit: "student record edited by alice@school"
  - Platform audit: "SUPER_ADMIN op@platform impersonated alice for
    14m on 2026-05-09"

## Exit paths

- **Explicit "Exit impersonation" button** — calls
  `POST /platform/impersonate/end`. Server returns a fresh
  SUPER_ADMIN token. The frontend swaps the stored token + writes
  the `IMPERSONATION_ENDED` audit row with `durationMs`.
- **Re-login** — signing into the school dashboard from a different
  tab / browser issues a normal token. The impersonation session's
  token is still valid until `exp`, but the operator no longer uses
  it. Phase 9 force-logout on the SUPER_ADMIN is the way to revoke
  it explicitly.

## Banner

The dashboard layout reads `getImpersonationContext()` from
localStorage and renders a sticky banner at the top of every page:

```
┌─────────────────────────────────────────────────────────┐
│ ⚠ Impersonating alice@school-a.edu (ADMIN @ school-a)   │
│   Started 12:34 by op@platform     [ Exit impersonation ]│
└─────────────────────────────────────────────────────────┘
```

Banner is rendered FIRST in the layout — above topbar, above
content. The operator can never miss they're in another user's
shoes.

## SUPER_ADMIN bypass

`SUPER_ADMIN` bypasses every `@RequireFeature` flag check (for
unimpersonated sessions). DURING impersonation, `req.user.role` is
the impersonated TARGET's role — so feature flags DO apply, just
as they would for the actual school admin. That's correct: if the
school's plan disables analytics, the impersonating SUPER_ADMIN
shouldn't see the analytics page either, because they're trying to
reproduce what the school sees.
