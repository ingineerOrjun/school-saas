import {
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface PlanChangedPayload {
  brand: BrandConfig;
  schoolName: string;
  adminEmail: string;
  /** Plan label before the change. */
  fromPlan: string;
  /** Plan label after the change. */
  toPlan: string;
  /** ISO end of the new period (null for UNLIMITED). */
  endDate: string | null;
  /** True iff the new plan is at a higher tier than the old one. */
  isUpgrade: boolean;
}

export const planChangedTemplate: NotificationTemplate<PlanChangedPayload> = {
  key: 'platform.plan_changed',
  defaultChannels: ['EMAIL'],
  renderEmail: (p) => {
    const verb = p.isUpgrade ? 'upgraded' : 'changed';
    const subject = `${p.brand.productName}: Plan ${verb} to ${p.toPlan}`;
    const friendlyEnd = p.endDate
      ? new Date(p.endDate).toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : null;

    const body = [
      emailHeading(p.isUpgrade ? 'Plan upgraded' : 'Plan changed'),
      emailParagraph(`Hello ${p.adminEmail},`),
      emailParagraph(
        `${p.schoolName}'s plan has been ${verb} from ${p.fromPlan} to ${p.toPlan}${
          friendlyEnd ? `, valid through ${friendlyEnd}` : ' with no expiry'
        }.`,
      ),
      p.isUpgrade
        ? emailParagraph(
            "You'll see any newly-included features unlock next time you sign in.",
          )
        : emailParagraph(
            'Some features may behave differently under the new plan. Sign in to review.',
          ),
    ].join('');

    const html = wrapEmail({
      brand: p.brand,
      preheader: `${p.fromPlan} → ${p.toPlan}`,
      body,
    });
    const text = [
      p.isUpgrade ? 'Plan upgraded.' : 'Plan changed.',
      ``,
      `Hello ${p.adminEmail},`,
      ``,
      `${p.schoolName}'s plan has been ${verb} from ${p.fromPlan} to ${p.toPlan}${friendlyEnd ? `, valid through ${friendlyEnd}` : ' with no expiry'}.`,
    ].join('\n');
    return { subject, html, text };
  },
};
