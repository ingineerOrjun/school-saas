import {
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface PromotionCompletedPayload {
  brand: BrandConfig;
  schoolName: string;
  /** Session label the school promoted FROM (e.g. "2082/83"). */
  fromSessionName: string;
  /** Session label the school promoted INTO. */
  toSessionName: string;
  /** Counts from PromotionService.run() result. */
  counts: {
    promoted: number;
    retained: number;
    left: number;
  };
}

export const promotionCompletedTemplate: NotificationTemplate<PromotionCompletedPayload> = {
  key: 'school.promotion_completed',
  defaultChannels: ['EMAIL', 'IN_APP'],
  renderInApp: (p) => ({
    title: `Promotion complete — ${p.toSessionName}`,
    body: `${p.counts.promoted} promoted, ${p.counts.retained} retained, ${p.counts.left} left. The active session is now ${p.toSessionName}.`,
  }),
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Promotion completed for ${p.schoolName}`;
    const body = [
      emailHeading('Promotion complete'),
      emailParagraph(
        `${p.schoolName} has successfully run the end-of-year promotion from ${p.fromSessionName} to ${p.toSessionName}.`,
      ),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;width:100%;font-size:13px;">
  <tr><td style="padding:6px 0;color:#64748b;width:200px;">Promoted</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">${p.counts.promoted}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Retained</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">${p.counts.retained}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Left</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">${p.counts.left}</td></tr>
  <tr><td style="padding:8px 0;border-top:1px solid #e2e8f0;color:#0f172a;">Active session</td><td style="padding:8px 0;border-top:1px solid #e2e8f0;color:#0f172a;font-weight:600;">${p.toSessionName}</td></tr>
</table>`,
      emailParagraph(
        'Per-student history records have been written and are available on each student profile under "Academic history".',
      ),
    ].join('');
    return {
      subject,
      html: wrapEmail({
        brand: p.brand,
        preheader: `${p.counts.promoted} promoted into ${p.toSessionName}`,
        body,
      }),
      text: [
        `Promotion complete.`,
        ``,
        `${p.schoolName} has successfully run the end-of-year promotion from ${p.fromSessionName} to ${p.toSessionName}.`,
        ``,
        `Promoted:        ${p.counts.promoted}`,
        `Retained:        ${p.counts.retained}`,
        `Left:            ${p.counts.left}`,
        `Active session:  ${p.toSessionName}`,
        ``,
        `Per-student history records have been written and are available on each student profile.`,
      ].join('\n'),
    };
  },
};
