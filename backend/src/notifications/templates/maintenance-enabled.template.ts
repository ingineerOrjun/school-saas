import {
  emailDivider,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface MaintenanceEnabledPayload {
  brand: BrandConfig;
  schoolName: string;
  /** Optional reason recorded by the SUPER_ADMIN at toggle time. */
  reason: string | null;
  /** ISO timestamp the toggle happened. */
  enabledAt: string;
}

export const maintenanceEnabledTemplate: NotificationTemplate<MaintenanceEnabledPayload> = {
  key: 'platform.maintenance_enabled',
  // School-wide (no per-user recipient) → IN_APP only by default.
  // Email opt-in left for the producer if it wants to fan out to admins.
  defaultChannels: ['IN_APP'],
  renderInApp: (p) => ({
    title: 'Maintenance mode enabled',
    body: p.reason
      ? `Writes are paused while support performs maintenance: ${p.reason}`
      : 'Writes are paused while support performs maintenance. Reads continue to work.',
  }),
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Maintenance mode enabled for ${p.schoolName}`;
    const friendlyDate = new Date(p.enabledAt).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const body = [
      emailHeading('Maintenance mode is on'),
      emailParagraph(
        `${p.schoolName}'s account has been placed in maintenance mode as of ${friendlyDate}.`,
      ),
      emailParagraph(
        'You can still sign in and read your data, but saving changes is paused while support completes the work.',
      ),
      p.reason
        ? `<blockquote style="margin:8px 0 16px 0;padding:10px 14px;border-left:3px solid #f59e0b;background:#fffbeb;color:#78350f;">${escape(p.reason)}</blockquote>`
        : '',
      emailDivider(),
      `<p style="margin:0;color:#64748b;font-size:12px;">A separate notice will go out when maintenance ends.</p>`,
    ].join('');
    return {
      subject,
      html: wrapEmail({
        brand: p.brand,
        preheader: 'Saving changes is paused while support completes work.',
        body,
      }),
      text: [
        `Maintenance mode is on.`,
        ``,
        `${p.schoolName}'s account has been placed in maintenance mode as of ${friendlyDate}.`,
        ``,
        p.reason ? `Reason: ${p.reason}` : '',
        ``,
        `You can still sign in and read your data, but saving changes is paused while support completes the work.`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
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
