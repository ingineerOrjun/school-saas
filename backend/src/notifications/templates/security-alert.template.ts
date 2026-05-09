import {
  emailDivider,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface SecurityAlertPayload {
  brand: BrandConfig;
  recipientEmail: string;
  /** Headline reason ("Multiple failed login attempts", "Suspicious sign-in"). */
  alertTitle: string;
  /** Free-form body line. */
  detail: string;
  /** ISO timestamp the event occurred. */
  occurredAt: string;
  /** Optional source IP (or "<unknown>"). */
  ip?: string | null;
  /** Optional URL to a "review activity" page. */
  reviewUrl?: string;
}

export const securityAlertTemplate: NotificationTemplate<SecurityAlertPayload> = {
  key: 'platform.security_alert',
  defaultChannels: ['EMAIL', 'IN_APP'],
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Security alert — ${p.alertTitle}`;
    const friendlyDate = new Date(p.occurredAt).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    const body = [
      emailHeading('Security alert'),
      emailParagraph(`Hello ${p.recipientEmail},`),
      emailParagraph(`${p.alertTitle} — ${friendlyDate}.`),
      `<blockquote style="margin:8px 0 16px 0;padding:10px 14px;border-left:3px solid #f59e0b;background:#fffbeb;color:#78350f;">${escape(p.detail)}</blockquote>`,
      p.ip
        ? `<p style="margin:0 0 12px 0;color:#64748b;font-size:12px;">Source: <code>${escape(p.ip)}</code></p>`
        : '',
      p.reviewUrl
        ? `<p style="margin:0 0 12px 0;">Review recent activity: <a href="${p.reviewUrl}" style="color:#0f172a;">${p.reviewUrl}</a></p>`
        : '',
      emailDivider(),
      `<p style="margin:0;color:#64748b;font-size:12px;">If this was you, no action is needed. If not, change your password and contact ${escape(p.brand.supportEmail)} immediately.</p>`,
    ].join('');

    const html = wrapEmail({
      brand: p.brand,
      preheader: p.alertTitle,
      body,
    });

    const text = [
      `Security alert.`,
      ``,
      `Hello ${p.recipientEmail},`,
      ``,
      `${p.alertTitle} — ${friendlyDate}`,
      ``,
      p.detail,
      ``,
      p.ip ? `Source: ${p.ip}` : '',
      p.reviewUrl ? `Review activity: ${p.reviewUrl}` : '',
      ``,
      `If this was you, no action is needed. If not, change your password and contact ${p.brand.supportEmail} immediately.`,
    ]
      .filter(Boolean)
      .join('\n');

    return { subject, html, text };
  },
  renderInApp: (p) => ({
    title: p.alertTitle,
    body: p.detail,
  }),
};

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
