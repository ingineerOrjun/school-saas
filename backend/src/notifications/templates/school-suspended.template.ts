import {
  emailDivider,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface SchoolSuspendedPayload {
  brand: BrandConfig;
  schoolName: string;
  /** Admin email — primary recipient. */
  adminEmail: string;
  /** Free-form reason recorded by the SUPER_ADMIN. */
  reason: string;
  /** ISO timestamp the suspension took effect. */
  suspendedAt: string;
}

export const schoolSuspendedTemplate: NotificationTemplate<SchoolSuspendedPayload> = {
  key: 'platform.school_suspended',
  defaultChannels: ['EMAIL'],
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Your school account has been suspended`;
    const friendlyDate = new Date(p.suspendedAt).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    const body = [
      emailHeading('Account suspended'),
      emailParagraph(`Hello ${p.adminEmail},`),
      emailParagraph(
        `${p.schoolName}'s account on ${p.brand.productName} has been suspended as of ${friendlyDate}. Until access is restored, no users at the school can sign in.`,
      ),
      emailParagraph('Reason recorded by support:'),
      `<blockquote style="margin:8px 0 16px 0;padding:10px 14px;border-left:3px solid #cbd5e1;background:#f8fafc;color:#334155;font-style:italic;">${escape(p.reason)}</blockquote>`,
      emailParagraph(
        `Your school's data is preserved untouched. Reach out to ${p.brand.supportEmail} to resolve the issue and restore access.`,
      ),
      emailDivider(),
      `<p style="margin:0;color:#64748b;font-size:12px;">This is an automated notice from ${escape(p.brand.productName)}'s platform team.</p>`,
    ].join('');

    const html = wrapEmail({
      brand: p.brand,
      preheader: 'Your school account has been suspended.',
      body,
    });

    const text = [
      `Your school account has been suspended.`,
      ``,
      `Hello ${p.adminEmail},`,
      ``,
      `${p.schoolName}'s account on ${p.brand.productName} has been suspended as of ${friendlyDate}. Until access is restored, no users at the school can sign in.`,
      ``,
      `Reason recorded by support: ${p.reason}`,
      ``,
      `Your school's data is preserved untouched. Contact ${p.brand.supportEmail} to resolve the issue and restore access.`,
    ].join('\n');

    return { subject, html, text };
  },
};

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
