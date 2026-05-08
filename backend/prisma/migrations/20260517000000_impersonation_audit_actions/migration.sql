-- Phase 7 — Impersonation. Two new audit action types added to the
-- existing PlatformAuditAction enum. No table changes needed —
-- `platform_audit_events` is shape-agnostic; only the action enum
-- grows when a new platform action lands.

ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'IMPERSONATION_STARTED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'IMPERSONATION_ENDED';
