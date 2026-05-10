import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// BrandConfigService — Phase 23 Sections 3 + 10.
//
// Resolves the *effective* brand for a tenant. Three layers, in
// priority order:
//
//   1. School (per-tenant overrides on `schools.brand*` fields).
//   2. Deployment (env-driven `mail.brand`, `appName`, etc).
//   3. Hard-coded fallbacks (so a misconfigured deployment still
//      renders a usable email).
//
// Used by:
//   • Email templates (subject, footer, support email).
//   • Receipts + report cards.
//   • Login page (logo + slogan).
//   • Dashboard shell (theme color CSS variables).
//
// White-label foundations (Section 10):
//   The same shape powers a multi-brand deployment — set the env
//   vars to the customer's brand at startup; per-tenant overrides
//   layer on top. A future "brand-per-domain" extension swaps the
//   middle layer to be domain-resolved instead of env-resolved
//   without changing the public interface.
// ---------------------------------------------------------------------------

const FALLBACKS = {
  appName: 'Scholaris',
  supportEmail: 'support@scholaris.local',
  primaryColor: '#0f172a',  // slate-900
  accentColor: '#3b82f6',   // blue-500
  logoUrl: null as string | null,
  slogan: null as string | null,
  receiptFooter: null as string | null,
  footerAddress: null as string | null,
};

export interface BrandConfig {
  /** Display name surfaced in titles + emails. */
  appName: string;
  supportEmail: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  slogan: string | null;
  /** Multi-line text shown at the bottom of receipts / report cards. */
  receiptFooter: string | null;
  /** Physical address line in email footers. */
  footerAddress: string | null;
  /** True when at least one tenant-level field overrode the default. */
  isCustomized: boolean;
}

@Injectable()
export class BrandConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Effective brand for a single school. Pulls the persisted
   * tenant overrides + falls back through env / hard-coded.
   */
  async forSchool(schoolId: string): Promise<BrandConfig> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        logoUrl: true,
        brandPrimaryColor: true,
        brandAccentColor: true,
        brandSlogan: true,
        brandReceiptFooter: true,
      },
    });
    return this.resolve(school);
  }

  /**
   * Deployment-level brand (no tenant override). Used by anonymous
   * pages (the login screen before the user picks a tenant) and
   * by /platform endpoints.
   */
  globalBrand(): BrandConfig {
    return this.resolve(null);
  }

  /**
   * Update the persisted brand fields for a school. Returns the
   * effective config after the change (so the caller can render
   * a live preview).
   */
  async setForSchool(
    schoolId: string,
    input: {
      brandPrimaryColor?: string | null;
      brandAccentColor?: string | null;
      brandSlogan?: string | null;
      brandReceiptFooter?: string | null;
    },
  ): Promise<BrandConfig> {
    await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        brandPrimaryColor: input.brandPrimaryColor ?? null,
        brandAccentColor: input.brandAccentColor ?? null,
        brandSlogan: input.brandSlogan ?? null,
        brandReceiptFooter: input.brandReceiptFooter ?? null,
      },
    });
    return this.forSchool(schoolId);
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  private resolve(
    school: {
      logoUrl?: string | null;
      brandPrimaryColor?: string | null;
      brandAccentColor?: string | null;
      brandSlogan?: string | null;
      brandReceiptFooter?: string | null;
    } | null,
  ): BrandConfig {
    const envBrand = this.config.get<{
      productName?: string;
      supportEmail?: string;
      logoUrl?: string;
      footerAddress?: string;
    }>('mail.brand') ?? {};

    const isCustomized = !!(
      school &&
      (school.brandPrimaryColor ||
        school.brandAccentColor ||
        school.brandSlogan ||
        school.brandReceiptFooter ||
        school.logoUrl)
    );

    return {
      appName: envBrand.productName ?? FALLBACKS.appName,
      supportEmail: envBrand.supportEmail ?? FALLBACKS.supportEmail,
      primaryColor:
        school?.brandPrimaryColor ?? FALLBACKS.primaryColor,
      accentColor:
        school?.brandAccentColor ?? FALLBACKS.accentColor,
      logoUrl: school?.logoUrl ?? envBrand.logoUrl ?? FALLBACKS.logoUrl,
      slogan: school?.brandSlogan ?? FALLBACKS.slogan,
      receiptFooter:
        school?.brandReceiptFooter ?? FALLBACKS.receiptFooter,
      footerAddress: envBrand.footerAddress ?? FALLBACKS.footerAddress,
      isCustomized,
    };
  }
}
