import {
  emailDivider,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface SchoolReactivatedPayload {
  brand: BrandConfig;
  schoolName: string;
  adminEmail: string;
  loginUrl: string;
}

export const schoolReactivatedTemplate: NotificationTemplate<SchoolReactivatedPayload> = {
  key: 'platform.school_reactivated',
  defaultChannels: ['EMAIL'],
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Your school account has been reactivated`;
    const body = [
      emailHeading('Account reactivated'),
      emailParagraph(`Hello ${p.adminEmail},`),
      emailParagraph(
        `Good news — ${p.schoolName}'s account on ${p.brand.productName} has been reactivated. Your teachers and staff can sign in again immediately.`,
      ),
      `<p style="margin:0 0 12px 0;">Sign in at <a href="${p.loginUrl}" style="color:#0f172a;">${p.loginUrl}</a></p>`,
      emailDivider(),
      `<p style="margin:0;color:#64748b;font-size:12px;">If you have questions about your account, reply to this email or contact ${p.brand.supportEmail}.</p>`,
    ].join('');
    const html = wrapEmail({
      brand: p.brand,
      preheader: 'Your school account has been reactivated.',
      body,
    });
    const text = [
      `Account reactivated.`,
      ``,
      `Hello ${p.adminEmail},`,
      ``,
      `${p.schoolName}'s account on ${p.brand.productName} has been reactivated. Your teachers and staff can sign in again immediately.`,
      ``,
      `Sign in: ${p.loginUrl}`,
    ].join('\n');
    return { subject, html, text };
  },
};
