import {
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface SubscriptionRenewedPayload {
  brand: BrandConfig;
  schoolName: string;
  adminEmail: string;
  /** New plan label (e.g. "YEARLY"). */
  plan: string;
  billingCycle: string;
  /** ISO start of the new period. */
  startDate: string;
  /** ISO end of the new period. Null when UNLIMITED. */
  endDate: string | null;
}

export const subscriptionRenewedTemplate: NotificationTemplate<SubscriptionRenewedPayload> = {
  key: 'platform.subscription_renewed',
  defaultChannels: ['EMAIL'],
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Subscription renewed for ${p.schoolName}`;
    const friendlyStart = new Date(p.startDate).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const friendlyEnd = p.endDate
      ? new Date(p.endDate).toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : null;

    const body = [
      emailHeading('Subscription renewed'),
      emailParagraph(`Hello ${p.adminEmail},`),
      emailParagraph(
        `${p.schoolName}'s ${p.brand.productName} subscription has been renewed.`,
      ),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;width:100%;font-size:13px;">
  <tr><td style="padding:6px 0;color:#64748b;width:140px;">Plan</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">${p.plan}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Billing cycle</td><td style="padding:6px 0;color:#0f172a;">${p.billingCycle}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Starts</td><td style="padding:6px 0;color:#0f172a;">${friendlyStart}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">${friendlyEnd ? 'Ends' : 'Expiry'}</td><td style="padding:6px 0;color:#0f172a;">${friendlyEnd ?? 'No expiry (UNLIMITED)'}</td></tr>
</table>`,
      emailParagraph('No further action is needed. Thanks for staying with us.'),
    ].join('');
    const html = wrapEmail({
      brand: p.brand,
      preheader: `Renewed: ${p.plan} · ${friendlyEnd ?? 'no expiry'}`,
      body,
    });
    const text = [
      `Subscription renewed.`,
      ``,
      `${p.schoolName}'s ${p.brand.productName} subscription has been renewed.`,
      ``,
      `Plan:          ${p.plan}`,
      `Billing cycle: ${p.billingCycle}`,
      `Starts:        ${friendlyStart}`,
      friendlyEnd ? `Ends:          ${friendlyEnd}` : `Expiry:        No expiry (UNLIMITED)`,
      ``,
      `No further action is needed.`,
    ].join('\n');
    return { subject, html, text };
  },
};
