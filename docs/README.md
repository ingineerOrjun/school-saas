# Scholaris Documentation

This directory is the engineering reference for the Scholaris platform.

## Start here

- **[PROJECT.md](./PROJECT.md)** — Comprehensive project documentation.
  Architecture, modules, API reference, migrations chronology, decision
  log, future scope. Read this first; the rest are deep-dives.

## Deep-dive reference

- **[platform/architecture.md](./platform/architecture.md)** — module
  map, request lifecycle, "where to look when X breaks" troubleshooting.
- **[platform/notifications.md](./platform/notifications.md)** —
  notification flow, channels, templates, Notification Center API,
  how to add a new template.
- **[platform/jobs.md](./platform/jobs.md)** — background job system,
  handler patterns, queue lifecycle, BullMQ migration path.
- **[platform/impersonation.md](./platform/impersonation.md)** —
  impersonation safety model, audit attribution, security invariants.

## Conventions

- All docs are Markdown. GitHub-flavored.
- Each doc has a clear "what this is" header and a navigable structure.
- Sections marked **⚠ Deferred** describe known gaps with reasoning.
  These are tracked decisions, not bugs.
- Tables are used for structured data (routes, models, env vars,
  enums). Prose explains tradeoffs.

## Keeping docs current

When you ship a new phase, migration, model, route, or significant
architectural decision:

1. Update the relevant section of `PROJECT.md`
2. If it's a new subsystem, add a deep-dive doc in `platform/`
3. Update `PROJECT.md`'s migration chronology, API reference, and
   migrations chronology tables

Stale docs cost more than keeping them current. The maintenance push
that produced this doc set is a bet that future work will land faster
when the next engineer doesn't have to spelunk.
