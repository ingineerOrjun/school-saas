import {
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface MaintenanceDisabledPayload {
  brand: BrandConfig;
  schoolName: string;
  /** ISO timestamp the toggle happened. */
  disabledAt: string;
}

export const maintenanceDisabledTemplate: NotificationTemplate<MaintenanceDisabledPayload> = {
  key: 'platform.maintenance_disabled',
  defaultChannels: ['IN_APP'],
  renderInApp: (_p) => ({
    title: 'Maintenance mode disabled',
    body: 'Writes have resumed. You can save changes again.',
  }),
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Maintenance complete for ${p.schoolName}`;
    const friendlyDate = new Date(p.disabledAt).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const body = [
      emailHeading('Maintenance complete'),
      emailParagraph(
        `${p.schoolName}'s account is back to normal as of ${friendlyDate}. Saving changes works again.`,
      ),
      emailParagraph('Thanks for your patience.'),
    ].join('');
    return {
      subject,
      html: wrapEmail({
        brand: p.brand,
        preheader: 'Writes have resumed.',
        body,
      }),
      text: [
        `Maintenance complete.`,
        ``,
        `${p.schoolName}'s account is back to normal as of ${friendlyDate}.`,
        `Saving changes works again.`,
        ``,
        `Thanks for your patience.`,
      ].join('\n'),
    };
  },
};
