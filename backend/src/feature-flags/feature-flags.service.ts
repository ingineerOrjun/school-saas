import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  defaultFeatureMap,
  FEATURE_CATALOG,
  VALID_FEATURE_KEYS,
} from './feature-catalog';

// ---------------------------------------------------------------------------
// Phase 5 — FeatureFlagsService.
//
// Resolves the effective feature map for a school by stacking three
// layers (highest precedence first):
//
//   1. school.featureOverrides     (platform-owner forcing)
//   2. subscription.enabledFeatures (current paid plan)
//   3. defaultFeatureMap()         (catalog fallback)
//
// Resolution semantics:
//   • A key explicitly set to `true` or `false` at any layer wins
//     immediately for that layer; lower layers are not consulted.
//   • Unknown keys (not in VALID_FEATURE_KEYS) are filtered out at
//     read time so a typo in an override map doesn't pollute the
//     resolved set.
//
// Why this service has NO audit dependency:
//   FeatureFlagsModule is @Global() so the guard is usable from any
//   feature module. PlatformModule registers the override-write
//   endpoint and ALSO emits the FEATURE_FLAG_CHANGED audit row at
//   the controller layer. Keeping the audit emission at the
//   controller (with full request context) avoids a circular module
//   dep between FeatureFlagsModule and PlatformModule.
//
// Caching:
//   None today — every request walks the school + subscription rows.
//   Latency is dominated by the JWT round-trip; resolving features
//   is one indexed lookup. Phase 9 (or earlier if profiling shows a
//   hot path) can add an in-memory cache keyed by schoolId with a
//   short TTL or invalidation hook on override writes.
// ---------------------------------------------------------------------------

export interface FeatureSet {
  /** Effective on/off per known feature key. */
  features: Record<string, boolean>;
  /** The platform-owner's override map (read-back for the platform UI). */
  overrides: Record<string, boolean>;
  /** What the current subscription says — null when no subscription on file. */
  subscription: Record<string, boolean> | null;
  /** Catalog defaults at this codebase version. */
  defaults: Record<string, boolean>;
}

export interface SetOverridesResult {
  /** Resolved feature set after the write. */
  set: FeatureSet;
  /** Override map BEFORE the write — caller emits audit with this. */
  before: Record<string, boolean>;
  /** True when the write changed something; false on a no-op. */
  changed: boolean;
  /** School name snapshot at the time of the write — for audit labels. */
  schoolName: string;
}

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the effective feature map for `schoolId`. Throws 404 if
   * the school doesn't exist (the caller has already authenticated;
   * a missing school is a programmer error, not a privacy leak).
   */
  async resolveForSchool(schoolId: string): Promise<FeatureSet> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, featureOverrides: true },
    });
    if (!school) throw new NotFoundException('School not found.');

    const sub = await this.prisma.schoolSubscription.findFirst({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      select: { enabledFeatures: true },
    });

    const overrides = sanitizeMap(school.featureOverrides);
    const subscription = sub ? sanitizeMap(sub.enabledFeatures) : null;
    const defaults = defaultFeatureMap();

    const features: Record<string, boolean> = { ...defaults };
    if (subscription) {
      for (const [k, v] of Object.entries(subscription)) features[k] = v;
    }
    for (const [k, v] of Object.entries(overrides)) features[k] = v;

    return { features, overrides, subscription, defaults };
  }

  /**
   * Bulk-resolve features for many schools at once. Used by the
   * cross-tenant `/platform/features` matrix view so we don't fan
   * out one-query-per-school.
   */
  async resolveForSchools(
    schoolIds: string[],
  ): Promise<Map<string, FeatureSet>> {
    if (schoolIds.length === 0) return new Map();

    const [schools, subs] = await Promise.all([
      this.prisma.school.findMany({
        where: { id: { in: schoolIds } },
        select: { id: true, featureOverrides: true },
      }),
      this.prisma.schoolSubscription.findMany({
        where: { schoolId: { in: schoolIds } },
        orderBy: [{ schoolId: 'asc' }, { createdAt: 'desc' }],
        select: { schoolId: true, enabledFeatures: true },
      }),
    ]);

    // Keep only the most recent subscription per schoolId.
    const subBySchool = new Map<string, Record<string, boolean>>();
    for (const s of subs) {
      if (!subBySchool.has(s.schoolId)) {
        subBySchool.set(s.schoolId, sanitizeMap(s.enabledFeatures));
      }
    }

    const defaults = defaultFeatureMap();
    const out = new Map<string, FeatureSet>();
    for (const sch of schools) {
      const overrides = sanitizeMap(sch.featureOverrides);
      const subscription = subBySchool.get(sch.id) ?? null;
      const features: Record<string, boolean> = { ...defaults };
      if (subscription) {
        for (const [k, v] of Object.entries(subscription)) features[k] = v;
      }
      for (const [k, v] of Object.entries(overrides)) features[k] = v;
      out.set(sch.id, { features, overrides, subscription, defaults });
    }
    return out;
  }

  /**
   * Cheap "is this one feature on?" check. Used by the runtime guard
   * — keeps the hot path simple. Same precedence rules as
   * `resolveForSchool` but skips the materialised maps.
   */
  async isEnabled(schoolId: string, key: string): Promise<boolean> {
    if (!VALID_FEATURE_KEYS.has(key)) {
      // Unknown keys default to "on" — guarding on a feature the
      // catalog doesn't know about is a coding error, but failing
      // closed would block legitimate traffic during migration
      // mistakes. Logged loudly so the mistake surfaces in dev.
      this.logger.warn(
        `isEnabled() called with unknown feature key "${key}" — defaulting to true.`,
      );
      return true;
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { featureOverrides: true },
    });
    if (!school) return false;

    const overrides = sanitizeMap(school.featureOverrides);
    if (key in overrides) return overrides[key];

    const sub = await this.prisma.schoolSubscription.findFirst({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      select: { enabledFeatures: true },
    });
    if (sub) {
      const subFlags = sanitizeMap(sub.enabledFeatures);
      if (key in subFlags) return subFlags[key];
    }

    const defaults = defaultFeatureMap();
    return defaults[key] ?? false;
  }

  /**
   * Replace the school-level override map. Returns the resolved
   * feature set after the write PLUS the override snapshot before
   * the write — the caller (PlatformController) emits the
   * FEATURE_FLAG_CHANGED audit row with that diff.
   *
   * Validates that every key is in the catalog and every value is a
   * boolean. No-op writes (identical to current) skip the DB update
   * and signal `changed: false` so the caller can skip the audit row.
   */
  async setOverrides(
    schoolId: string,
    overrides: Record<string, boolean>,
  ): Promise<SetOverridesResult> {
    // Validate.
    const cleaned: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(overrides ?? {})) {
      if (!VALID_FEATURE_KEYS.has(k)) {
        throw new BadRequestException(
          `Unknown feature key "${k}". Valid keys: ${[
            ...VALID_FEATURE_KEYS,
          ].join(', ')}.`,
        );
      }
      if (typeof v !== 'boolean') {
        throw new BadRequestException(
          `Feature "${k}" must be a boolean (received ${typeof v}).`,
        );
      }
      cleaned[k] = v;
    }

    const before = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, featureOverrides: true },
    });
    if (!before) throw new NotFoundException('School not found.');

    const beforeOverrides = sanitizeMap(before.featureOverrides);
    if (mapsEqual(beforeOverrides, cleaned)) {
      const set = await this.resolveForSchool(schoolId);
      return {
        set,
        before: beforeOverrides,
        changed: false,
        schoolName: before.name,
      };
    }

    await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        featureOverrides: cleaned as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `[platform] feature overrides changed school=${before.name}(${schoolId}) ` +
        `keys=${Object.keys(cleaned).length}`,
    );

    const set = await this.resolveForSchool(schoolId);
    return {
      set,
      before: beforeOverrides,
      changed: true,
      schoolName: before.name,
    };
  }

  /** Expose the catalog for the platform UI / `/me/features` payload. */
  getCatalog() {
    return FEATURE_CATALOG.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      defaultEnabled: f.defaultEnabled,
      comingSoon: !!f.comingSoon,
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Drop unknown keys + non-boolean values from a stored JSON map. The
 * catalog evolves over time (a key can be retired, a new one can be
 * added) and we don't want stale/garbage values surfacing in the
 * resolved set.
 */
function sanitizeMap(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_FEATURE_KEYS.has(k)) continue;
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function mapsEqual(
  a: Record<string, boolean>,
  b: Record<string, boolean>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}
