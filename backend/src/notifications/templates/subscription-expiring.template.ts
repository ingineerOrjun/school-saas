import {
  emailButton,
  emailDivider,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface SubscriptionExpiringPayload {
  brand: BrandConfig;
  schoolName: string;
  /** Admin email — primary recipient. */
  adminEmail: string;
  /** Days remaining; can be negative when used as a "you're past" notice. */
  daysRemaining: number;
  /** ISO end-date for clarity. */
  endDate: string;
  /** Plan label ("MONTHLY", "YEARLY", etc.). */
  plan: string;
  /** URL to the dashboard's billing settings, or to a renewal flow. */
  billingUrl: string;
}

export const subscriptionExpiringTemplate: NotificationTemplate<SubscriptionExpiringPayload> = {
  key: 'platform.subscription_expiring',
  defaultChannels: ['EMAIL', 'IN_APP'],
  renderEmail: (p) => {
    const friendlyDate = new Date(p.endDate).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const subject =
      p.daysRemaining < 0
        ? `${p.brand.productName}: Your subscription has expired`
        : p.daysRemaining === 0
          ? `${p.brand.productName}: Your subscription expires today`
          : `${p.brand.productName}: Your subscription expires in ${p.daysRemaining} day${p.daysRemaining === 1 ? '' : 's'}`;

    const lead =
      p.daysRemaining < 0
        ? `${p.schoolName}'s ${p.plan} plan expired on ${friendlyDate}. Users at the school can no longer sign in.`
        : `${p.schoolName}'s ${p.plan} plan expires on ${friendlyDate} (${p.daysRemaining} day${p.daysRemaining === 1 ? '' : 's'} from now).`;

    const body = [
      emailHeading(
        p.daysRemaining < 0 ? 'Subscription expired' : 'Subscription expiring soon',
      ),
      emailParagraph(`Hello ${p.adminEmail},`),
      emailParagraph(lead),
      emailParagraph(
        p.daysRemaining < 0
          ? 'Renew now to restore access for your teachers and staff.'
          : 'Renew now to avoid any disruption for your teachers and staff.',
      ),
      emailButton('Manage subscription', p.billingUrl),
      emailDivider(),
      `<p style="margin:0;color:#64748b;font-size:12px;">If you've already renewed, you can ignore this email — it may take a moment for the change to reach our records.</p>`,
    ].join('');
    const html = wrapEmail({
      brand: p.brand,
      preheader:
        p.daysRemaining < 0
          ? 'Your subscription has expired.'
          : `Your subscription expires in ${p.daysRemaining} days.`,
      body,
    });

    const text = [
      p.daysRemaining < 0
        ? 'Subscription expired.'
        : 'Subscription expiring soon.',
      ``,
      `Hello ${p.adminEmail},`,
      ``,
      lead,
      ``,
      p.daysRemaining < 0
        ? 'Renew now to restore access for your teachers and staff.'
        : 'Renew now to avoid any disruption for your teachers and staff.',
      ``,
      `Manage subscription: ${p.billingUrl}`,
    ].join('\n');

    return { subject, html, text };
  },
  renderInApp: (p) => ({
    title:
      p.daysRemaining < 0
        ? 'Your subscription has expired'
        : `Your subscription expires in ${p.daysRemaining} day${p.daysRemaining === 1 ? '' : 's'}`,
    body:
      p.daysRemaining < 0
        ? `${p.schoolName}'s ${p.plan} plan ended on ${new Date(p.endDate).toLocaleDateString()}. Renew to restore access.`
        : `${p.schoolName}'s ${p.plan} plan ends on ${new Date(p.endDate).toLocaleDateString()}. Renew to avoid disruption.`,
  }),
};
