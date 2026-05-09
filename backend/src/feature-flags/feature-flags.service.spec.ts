import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureKey, FEATURE_CATALOG } from './feature-catalog';
import type { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// FeatureFlagsService — Phase 4 maturity tests.
//
// The resolution stack is the heart of feature gating. Three layers,
// override > subscription > catalog default, each tested
// independently AND in combination so a regression in any one layer
// fails loudly. The `setOverrides` writer is tested for:
//   • input validation (unknown keys / non-boolean values rejected)
//   • no-op detection (identical writes don't churn the row)
//   • happy-path persistence + sanitised return value
// ---------------------------------------------------------------------------

interface SchoolRow {
  id: string;
  name: string;
  featureOverrides: Record<string, boolean>;
}

interface SubscriptionRow {
  id: string;
  schoolId: string;
  enabledFeatures: Record<string, boolean>;
  createdAt: Date;
}

function buildHarness() {
  const schools = new Map<string, SchoolRow>();
  const subscriptions: SubscriptionRow[] = [];

  const prisma: Partial<PrismaService> = {
    school: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const s = schools.get(where.id);
        if (!s) return null;
        const out: any = {};
        for (const k of Object.keys(select)) {
          out[k] = (s as any)[k];
        }
        return out;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where.id?.in ?? [];
        return ids
          .map((id) => schools.get(id))
          .filter(Boolean)
          .map((s) => ({
            id: s!.id,
            featureOverrides: s!.featureOverrides,
          }));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = schools.get(where.id);
        if (!s) throw new Error('not found');
        if (data.featureOverrides !== undefined) {
          s.featureOverrides = data.featureOverrides;
        }
        return s;
      }),
    } as any,
    schoolSubscription: {
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          subscriptions
            .filter((s) => s.schoolId === where.schoolId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
          null
        );
      }),
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where.schoolId?.in ?? [];
        return subscriptions
          .filter((s) => ids.includes(s.schoolId))
          .sort((a, b) => {
            if (a.schoolId !== b.schoolId)
              return a.schoolId < b.schoolId ? -1 : 1;
            return b.createdAt.getTime() - a.createdAt.getTime();
          })
          .map((s) => ({
            schoolId: s.schoolId,
            enabledFeatures: s.enabledFeatures,
          }));
      }),
    } as any,
  };

  const service = new FeatureFlagsService(prisma as PrismaService);
  return { service, schools, subscriptions };
}

const makeSchool = (overrides: Partial<SchoolRow> = {}): SchoolRow => ({
  id: 's-1',
  name: 'Acme High',
  featureOverrides: {},
  ...overrides,
});

describe('FeatureFlagsService', () => {
  describe('resolveForSchool', () => {
    it('falls back to catalog defaults when no override + no subscription', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());

      const result = await h.service.resolveForSchool('s-1');

      // Every catalog entry should be present in `features`.
      for (const def of FEATURE_CATALOG) {
        expect(result.features[def.key]).toBe(def.defaultEnabled);
      }
      expect(result.overrides).toEqual({});
      expect(result.subscription).toBeNull();
    });

    it('subscription overrides catalog default', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());
      h.subscriptions.push({
        id: 'sub-1',
        schoolId: 's-1',
        enabledFeatures: {
          // `sms` defaults to false — subscription forces it on.
          [FeatureKey.Sms]: true,
          // `analytics` defaults to true — subscription forces it off.
          [FeatureKey.Analytics]: false,
        },
        createdAt: new Date(),
      });

      const result = await h.service.resolveForSchool('s-1');

      expect(result.features[FeatureKey.Sms]).toBe(true);
      expect(result.features[FeatureKey.Analytics]).toBe(false);
      // Untouched keys still fall back to default.
      expect(result.features[FeatureKey.Announcements]).toBe(true);
    });

    it('override beats subscription beats default (full layering)', async () => {
      const h = buildHarness();
      h.schools.set(
        's-1',
        makeSchool({
          featureOverrides: {
            // Force the analytics flag back ON, overriding the
            // subscription that disabled it.
            [FeatureKey.Analytics]: true,
          },
        }),
      );
      h.subscriptions.push({
        id: 'sub-1',
        schoolId: 's-1',
        enabledFeatures: {
          [FeatureKey.Analytics]: false,
          [FeatureKey.Sms]: true,
        },
        createdAt: new Date(),
      });

      const result = await h.service.resolveForSchool('s-1');

      // Override wins.
      expect(result.features[FeatureKey.Analytics]).toBe(true);
      // Subscription wins where there's no override.
      expect(result.features[FeatureKey.Sms]).toBe(true);
    });

    it('uses the MOST RECENT subscription when several exist', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());
      const oldSub: SubscriptionRow = {
        id: 'sub-old',
        schoolId: 's-1',
        enabledFeatures: { [FeatureKey.Sms]: true },
        createdAt: new Date('2024-01-01'),
      };
      const newSub: SubscriptionRow = {
        id: 'sub-new',
        schoolId: 's-1',
        enabledFeatures: { [FeatureKey.Sms]: false },
        createdAt: new Date('2025-01-01'),
      };
      h.subscriptions.push(oldSub, newSub);

      const result = await h.service.resolveForSchool('s-1');
      expect(result.features[FeatureKey.Sms]).toBe(false);
    });

    it('drops unknown keys in stored maps so stale data cannot pollute resolution', async () => {
      const h = buildHarness();
      h.schools.set(
        's-1',
        makeSchool({
          featureOverrides: {
            [FeatureKey.Analytics]: true,
            // A retired/typo'd key — must not appear in the resolved set.
            ['retired_widget']: true as any,
          },
        }),
      );

      const result = await h.service.resolveForSchool('s-1');

      expect(result.overrides).not.toHaveProperty('retired_widget');
      expect(result.features).not.toHaveProperty('retired_widget');
      expect(result.overrides[FeatureKey.Analytics]).toBe(true);
    });

    it('throws NotFoundException for an unknown school', async () => {
      const h = buildHarness();
      await expect(h.service.resolveForSchool('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('isEnabled (hot-path guard query)', () => {
    it('returns true when override forces it on', async () => {
      const h = buildHarness();
      h.schools.set(
        's-1',
        makeSchool({ featureOverrides: { [FeatureKey.Sms]: true } }),
      );
      expect(await h.service.isEnabled('s-1', FeatureKey.Sms)).toBe(true);
    });

    it('returns false when override forces it off (even if subscription enables it)', async () => {
      const h = buildHarness();
      h.schools.set(
        's-1',
        makeSchool({ featureOverrides: { [FeatureKey.Analytics]: false } }),
      );
      h.subscriptions.push({
        id: 'sub',
        schoolId: 's-1',
        enabledFeatures: { [FeatureKey.Analytics]: true },
        createdAt: new Date(),
      });
      expect(await h.service.isEnabled('s-1', FeatureKey.Analytics)).toBe(
        false,
      );
    });

    it('returns subscription value when no override', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());
      h.subscriptions.push({
        id: 'sub',
        schoolId: 's-1',
        enabledFeatures: { [FeatureKey.Sms]: true },
        createdAt: new Date(),
      });
      expect(await h.service.isEnabled('s-1', FeatureKey.Sms)).toBe(true);
    });

    it('falls back to catalog default when no layer specifies', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());
      // analytics defaults TRUE, sms defaults FALSE.
      expect(await h.service.isEnabled('s-1', FeatureKey.Analytics)).toBe(true);
      expect(await h.service.isEnabled('s-1', FeatureKey.Sms)).toBe(false);
    });

    it('fails OPEN (returns true) for an unknown feature key', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());
      expect(await h.service.isEnabled('s-1', 'not_in_catalog')).toBe(true);
    });
  });

  describe('setOverrides', () => {
    it('rejects unknown feature keys', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());
      await expect(
        h.service.setOverrides('s-1', { totally_made_up: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-boolean values', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());
      await expect(
        h.service.setOverrides('s-1', {
          [FeatureKey.Sms]: 'on' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('persists the new override map and reports changed=true', async () => {
      const h = buildHarness();
      const school = makeSchool({ featureOverrides: {} });
      h.schools.set('s-1', school);

      const result = await h.service.setOverrides('s-1', {
        [FeatureKey.Sms]: true,
      });

      expect(result.changed).toBe(true);
      expect(school.featureOverrides).toEqual({ [FeatureKey.Sms]: true });
      expect(result.set.overrides).toEqual({ [FeatureKey.Sms]: true });
    });

    it('detects a no-op write (identical map) and skips the DB update', async () => {
      const h = buildHarness();
      const school = makeSchool({
        featureOverrides: { [FeatureKey.Sms]: true },
      });
      h.schools.set('s-1', school);
      const updateSpy = jest.spyOn((h as any).service.prisma.school, 'update');

      const result = await h.service.setOverrides('s-1', {
        [FeatureKey.Sms]: true,
      });

      expect(result.changed).toBe(false);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});
