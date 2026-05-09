# Scholaris — Platform Architecture

This document is the operator's map of the Scholaris platform layer.
It describes how the SUPER_ADMIN-tier surface is wired together,
which modules own what, and where to look when something breaks.

## Surfaces

Scholaris exposes two distinct surfaces with different audiences,
visual languages, and security postures:

- **School dashboard** (`/(dashboard)/...`) — what teachers, staff,
  and school admins use. Tenant-scoped. Soft visual language (school
  primary color, rounded cards, glass effects). Gates: JWT +
  per-feature role guards.
- **Platform Control Layer** (`/platform/...`) — what platform
  owners (`SUPER_ADMIN`) use. Cross-tenant. Operational visual
  language (slate, dense, no decoration). Gate:
  `@Roles(SUPER_ADMIN)` on every controller.

The two never share components or layouts. Cross-pollination is a
bug — the school side has its own primitives in
`frontend/components/ui/`, and the platform side uses
`frontend/components/platform-ui/`.

## Module map

```
backend/src/
├── auth/                    JWT auth, login, registration, JwtStrategy
├── platform/                Platform Control Layer
│   ├── platform.controller  /platform/* routes
│   ├── platform.service     Schools list, status mutations
│   ├── subscription.service Subscription periods (append-only)
│   ├── security.service     Force-logout, admin password reset
│   ├── impersonation.service SUPER_ADMIN → school user token swap
│   ├── platform-audit.service Append-only audit ingestion
│   ├── school-snapshot.service /platform/schools/:id/snapshot
│   ├── subscription-expiring.job Daily cron
│   └── jobs/                Per-platform job handlers
├── feature-flags/           @Global. Per-tenant feature gating
│   ├── feature-flags.service Resolution: override > sub > default
│   ├── feature-flags.guard  @RequireFeature() runtime enforcement
│   └── feature-catalog      Catalog of every flag the platform knows
├── health/                  @Global. In-memory operator pulse
│   └── health.service       Uptime, DB probe, error/login ring buffers
├── notifications/           @Global. Centralized delivery
│   ├── notification.service Synchronous enqueue (legacy callers)
│   ├── notification-center.* Phase 14 operator inbox API
│   ├── channels/            Email + in-app handlers
│   ├── handlers/            JobHandler-shaped async dispatchers
│   ├── providers/           Email provider abstraction
│   └── templates/           HTML/plain-text template registry
└── common/
    ├── jobs/                @Global. In-process job queue
    │   ├── job-queue.service   DB-backed enqueue + claim
    │   ├── job-runner.service  Poll loop + handler dispatch
    │   ├── job-registry.service name → handler lookup
    │   └── job-handler.interface JobHandler contract
    ├── filters/             AllExceptionsFilter (feeds health)
    └── throttle/            UserAwareThrottlerGuard (per-user)
```

## Request lifecycle

A typical SUPER_ADMIN request:

```
HTTP request
  ↓
UserAwareThrottlerGuard       (per-user-id rate limit)
  ↓
JwtAuthGuard                  (token signature, watermark check)
  ↓
RolesGuard                    (@Roles(SUPER_ADMIN) match?)
  ↓
FeatureFlagsGuard             (only on @RequireFeature() routes)
  ↓
Controller method             (the actual platform logic)
  ↓
PlatformAuditService.record   (write-paths only — append-only)
  ↓
NotificationService.enqueue   (best-effort side-effect)
  ↓
Response
```

Any throw between these layers is caught by `AllExceptionsFilter`,
which both responds and feeds the health ring buffer.

## Source-of-truth tables

| Concern | Table | Owning service |
|---|---|---|
| Tenants | `schools` | `PlatformService` |
| User accounts | `users` | `AuthService`, `UserService` |
| Subscriptions (append-only) | `school_subscriptions` | `SubscriptionService` |
| Platform audit (append-only) | `platform_audit_events` | `PlatformAuditService` |
| Per-tenant feature overrides | `schools.featureOverrides` (JSON) | `FeatureFlagsService` |
| Notifications | `notifications` + `notification_deliveries` | `NotificationService`, `NotificationCenterService` |
| Background jobs | `jobs` | `JobQueueService` |

Append-only tables (`school_subscriptions`, `platform_audit_events`)
are never edited. A "change" is always a new row.

## Security posture

- **Tenant isolation** — every domain query filters by `schoolId`.
  Tested in service-level unit tests; enforced by per-route guards.
- **Platform bypass** — only `SUPER_ADMIN` cross-tenant. No other
  role can reach `/platform/*` routes.
- **Defense-in-depth** — login + status gates re-check tenant state
  even after the controller-level role guard passes.
- **Watermark-based session invalidation** — `users.tokensValidAfter`
  rejects JWTs older than the watermark, even if their `exp` is
  still in the future. Phase 9 force-logout flips this.
- **Append-only audit** — every platform write produces a
  `platform_audit_events` row with actor, target, before/after,
  reason, IP, user-agent. The audit row never carries secret material
  (e.g. password reset writes the watermark, NOT the temp password).
- **Rate limiting** — global 600/min/user via
  `UserAwareThrottlerGuard`; tighter buckets on `/auth/login` (10/min/IP)
  and `/auth/register` (5/hour/IP).

## Where to look when X breaks

- **A user can't log in** → `AuthService.login` (credential check),
  `PlatformService.assertSchoolCanLogin` (tenant gate), `JwtStrategy`
  (token watermark).
- **A platform write went through but no audit row** →
  `PlatformAuditService.record` swallows errors; check stderr for
  `Failed to record platform audit event`.
- **A feature is disabled but still loads** → `FeatureFlagsGuard`
  runs in stack order. If the route doesn't have `@RequireFeature()`,
  it's not gated. Frontend has its own gate via `<FeatureGate>` /
  the sidebar's `requiresFeature`.
- **An email never sent** → check `notification_deliveries.status`.
  If `FAILED`, `errorMessage` has the provider error. If `SKIPPED`,
  the channel had no handler or no recipient.
- **A job is stuck** → `SELECT * FROM jobs WHERE status='PENDING'
  ORDER BY runAt ASC LIMIT 10`. Check `lastError` for retry causes.
- **The error rate spiked** → `/platform/health` shows the last
  hour's 5xx count + a 50-row tail of recent errors with route +
  message.
