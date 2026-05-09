-- ---------------------------------------------------------------------------
-- Phase 15 — Jobs.
--
-- Lightweight in-process job system. The DB table is the source of
-- truth for:
--   • retry state (so a process restart doesn't lose pending work),
--   • idempotency / dedupe (the (name, dedupeKey) unique index),
--   • observability (operators query the table to see what's running,
--     what failed, and how many attempts each job has made),
--   • future scheduled jobs (`runAt` lets us defer execution).
--
-- The runtime worker still lives in-process — Postgres is only the
-- store. When we move to Redis/BullMQ later this table becomes
-- vestigial OR a long-term audit log; the queue interface in
-- src/common/jobs/job-queue.ts is the abstraction that survives.
--
-- Status lifecycle:
--   PENDING  → SCHEDULED   (claimed by a worker, will run when due)
--   SCHEDULED → RUNNING    (worker began executing)
--   RUNNING  → SUCCEEDED   (handler resolved without throwing)
--   RUNNING  → FAILED      (handler threw; retries exhausted)
--   RUNNING  → PENDING     (handler threw; retries available;
--                           runAt bumped to the next backoff window)
--   *        → DEAD        (operator-killed; not entered automatically)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobStatus') THEN
    CREATE TYPE "JobStatus" AS ENUM (
      'PENDING',
      'SCHEDULED',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
      'DEAD'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "jobs" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable handler key, e.g. "notification.send_delivery". The
  -- registry maps this to a TypeScript handler function.
  "name"         TEXT NOT NULL,
  -- Caller-supplied payload — opaque to the queue, parsed by the
  -- handler. JSON, never holds secrets that shouldn't be at rest.
  "payload"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Idempotency key. (name, dedupeKey) is unique when both set —
  -- enqueueing the same logical job twice collapses to one row.
  "dedupeKey"    TEXT,
  "status"       "JobStatus" NOT NULL DEFAULT 'PENDING',
  -- When this job becomes eligible to run. NULL = "now" semantics
  -- via index on (status, runAt).
  "runAt"        TIMESTAMP NOT NULL DEFAULT now(),
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "maxAttempts"  INTEGER NOT NULL DEFAULT 3,
  -- Last error message on a failed attempt, truncated by the
  -- service layer to keep rows compact.
  "lastError"    TEXT,
  "startedAt"    TIMESTAMP,
  "completedAt"  TIMESTAMP,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "jobs_name_dedupe_uniq"
  ON "jobs" ("name", "dedupeKey");

-- Worker poll: "give me the next PENDING job whose runAt <= now()".
-- The partial index keeps the scan tiny even when the table grows
-- with completed history.
CREATE INDEX IF NOT EXISTS "jobs_pending_due_idx"
  ON "jobs" ("runAt")
  WHERE "status" = 'PENDING';

CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" ("status");
CREATE INDEX IF NOT EXISTS "jobs_name_status_idx" ON "jobs" ("name", "status");
