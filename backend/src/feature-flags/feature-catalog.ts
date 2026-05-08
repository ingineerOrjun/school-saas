// ---------------------------------------------------------------------------
// Phase 5 — Feature flag catalog.
//
// Single source of truth for every feature key the platform knows
// about. Both backend (the FeatureFlagsGuard) and the platform UI
// (the per-school feature matrix) consume this list.
//
// Adding a feature:
//   1. Add a new key here with a sensible `defaultEnabled`.
//   2. Apply `@RequireFeature(FeatureKey.X)` to the relevant
//      controller(s) so the guard rejects requests when disabled.
//   3. Hide the matching frontend nav entry / page entry-point via
//      the shared catalog list (frontend/lib/features.ts mirrors
//      this file).
//
// Why hard-coded vs. database-driven:
//   The set of valid feature keys is part of the application's
//   shape — adding "transport" requires routing code, controllers,
//   and UI. Keeping the catalog in source matches that reality and
//   lets writers reject unknown keys at the API boundary.
// ---------------------------------------------------------------------------

/**
 * Stable enum of every feature flag the platform knows about. Used
 * as a string union by both the guard and the platform UI.
 *
 * Keep keys in lowerCamelCase — they're persisted as JSON object
 * keys verbatim, and we don't want capitalisation drift between
 * frontend and backend.
 */
export const FeatureKey = {
  /** Admin analytics dashboard (charts, exports). */
  Analytics: 'analytics',
  /** School-wide announcements module. */
  Announcements: 'announcements',
  /** End-of-year promotion / session lock workflow. */
  Promotion: 'promotion',
  /** SMS notifications — placeholder for a future Phase 6+ feature. */
  Sms: 'sms',
  /** Transport / route management — placeholder for future. */
  Transport: 'transport',
  /** Hostel management — placeholder for future. */
  Hostel: 'hostel',
} as const;

export type FeatureKeyValue = (typeof FeatureKey)[keyof typeof FeatureKey];

export interface FeatureDefinition {
  /** Stable JSON key (also used in URLs / API payloads). */
  key: FeatureKeyValue;
  /** Short human label for the platform UI. */
  label: string;
  /** One-line explainer for the platform UI tooltip. */
  description: string;
  /** Default when neither the override nor the subscription says. */
  defaultEnabled: boolean;
  /**
   * If true, this feature is still being scoped — it appears in the
   * UI as "Coming soon" and the override is harmless (no backend
   * routes guard on it yet). Lets us pre-stage rows for marketing.
   */
  comingSoon?: boolean;
}

/**
 * Catalog ordered for display on the platform features matrix.
 *
 * Default rule of thumb:
 *   • Existing modules (analytics / announcements / promotion) are
 *     enabled by default — disabling forces an opt-out, which keeps
 *     legacy schools working unchanged when Phase 5 ships.
 *   • Future modules (sms / transport / hostel) are disabled by
 *     default — opt-in only, no surprise feature exposure.
 */
export const FEATURE_CATALOG: readonly FeatureDefinition[] = [
  {
    key: FeatureKey.Analytics,
    label: 'Analytics',
    description: 'Admin analytics dashboard with cross-module charts and exports.',
    defaultEnabled: true,
  },
  {
    key: FeatureKey.Announcements,
    label: 'Announcements',
    description: 'School-wide messaging visible to every authenticated user.',
    defaultEnabled: true,
  },
  {
    key: FeatureKey.Promotion,
    label: 'Promotion',
    description: 'End-of-year promotion workflow + session lock.',
    defaultEnabled: true,
  },
  {
    key: FeatureKey.Sms,
    label: 'SMS Notifications',
    description: 'Outbound SMS for fee dues, attendance alerts, and reminders.',
    defaultEnabled: false,
    comingSoon: true,
  },
  {
    key: FeatureKey.Transport,
    label: 'Transport',
    description: 'Route management, vehicle assignments, and pickup logs.',
    defaultEnabled: false,
    comingSoon: true,
  },
  {
    key: FeatureKey.Hostel,
    label: 'Hostel',
    description: 'Room allocation, attendance, and hostel fee tracking.',
    defaultEnabled: false,
    comingSoon: true,
  },
];

/** All valid feature keys as a Set — used by writers to reject typos. */
export const VALID_FEATURE_KEYS: ReadonlySet<string> = new Set(
  FEATURE_CATALOG.map((f) => f.key),
);

/** Quick lookup of a definition by key. */
export const FEATURE_BY_KEY: ReadonlyMap<string, FeatureDefinition> = new Map(
  FEATURE_CATALOG.map((f) => [f.key, f]),
);

/**
 * The "all defaults" map. Used as the bedrock layer of the resolved
 * feature set when neither the school override nor the subscription
 * says anything about a key.
 */
export function defaultFeatureMap(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of FEATURE_CATALOG) out[f.key] = f.defaultEnabled;
  return out;
}
