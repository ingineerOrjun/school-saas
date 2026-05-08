-- ---------------------------------------------------------------------------
-- Phase 5 — Feature flags.
--
-- Modular feature control. Three layers (highest precedence first):
--
--   1. School-level override   (`schools.featureOverrides`).
--      Set by the platform owner to FORCE a feature on or off for a
--      specific tenant, regardless of plan. Most common use: gifting
--      a feature to a TRIAL school, or disabling SMS for a tenant
--      that's racking up bills.
--
--   2. Subscription-level flag (`school_subscriptions.enabledFeatures`).
--      Already shipped in Phase 4 — captures what the plan includes.
--      A new subscription period replaces the previous one's flags;
--      the override layer above is the long-lived knob.
--
--   3. Default catalog (in code).
--      The conservative default for every feature key. Real
--      enforcement reads it as the fallback when neither the
--      override nor the subscription says anything.
--
-- The override column is intentionally `Json @default("{}")` rather
-- than typed columns. New features will land regularly (Phase 6+
-- adds transport/hostel/sms etc.); a typed schema would force a
-- migration per feature. The catalog of valid keys is documented in
-- code (see backend/src/feature-flags/feature-catalog.ts) and the
-- API rejects unknown keys at write time.
--
-- One new audit action — FEATURE_FLAG_CHANGED — captures every
-- write to the override column. Subscription writes already get
-- their own SUBSCRIPTION_CREATED audit, so the chain is complete.
-- ---------------------------------------------------------------------------

ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "featureOverrides" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'FEATURE_FLAG_CHANGED';
