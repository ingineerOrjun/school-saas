import {
  emailDivider,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface RefundReceiptPayload {
  brand: BrandConfig;
  recipientEmail: string;
  schoolName: string;
  studentName: string;
  /** Auto-generated receipt for the REFUND row (FR-…-R or similar). */
  receiptNumber: string;
  /** Always positive (the absolute amount refunded). */
  amount: number;
  /** Pre-formatted "रु. 12,345.00" string from the producer. */
  amountFormatted: string;
  /** ISO date the refund was recorded. */
  refundedAt: string;
  /** Operator-supplied reason captured at refund time. */
  reason: string | null;
  /** Receipt number of the ORIGINAL payment being reversed (for the trail). */
  originalReceiptNumber: string | null;
  /** Cashier email if available. */
  refundedBy?: string;
}

export const refundReceiptTemplate: NotificationTemplate<RefundReceiptPayload> = {
  key: 'school.refund_receipt',
  defaultChannels: ['EMAIL', 'IN_APP'],
  renderInApp: (p) => ({
    title: `Refund issued — ${p.amountFormatted}`,
    body: `${p.schoolName} has issued a refund of ${p.amountFormatted} for ${p.studentName}${
      p.originalReceiptNumber ? ` against ${p.originalReceiptNumber}` : ''
    }${p.reason ? `. Reason: ${p.reason}` : '.'}`,
  }),
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Refund receipt ${p.receiptNumber}`;
    const friendlyDate = new Date(p.refundedAt).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const body = [
      emailHeading('Refund issued'),
      emailParagraph(
        `${p.schoolName} has recorded the following refund for ${p.studentName}.`,
      ),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;width:100%;font-size:13px;">
  <tr><td style="padding:6px 0;color:#64748b;width:160px;">Refund receipt #</td><td style="padding:6px 0;font-family:Menlo,Monaco,monospace;color:#0f172a;">${escape(p.receiptNumber)}</td></tr>
  ${
    p.originalReceiptNumber
      ? `<tr><td style="padding:6px 0;color:#64748b;">Reverses receipt</td><td style="padding:6px 0;font-family:Menlo,Monaco,monospace;color:#0f172a;">${escape(p.originalReceiptNumber)}</td></tr>`
      : ''
  }
  <tr><td style="padding:6px 0;color:#64748b;">Date</td><td style="padding:6px 0;color:#0f172a;">${escape(friendlyDate)}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Student</td><td style="padding:6px 0;color:#0f172a;">${escape(p.studentName)}</td></tr>
  <tr><td style="padding:8px 0;border-top:1px solid #e2e8f0;color:#0f172a;font-weight:600;">Amount refunded</td><td style="padding:8px 0;border-top:1px solid #e2e8f0;color:#0f172a;font-weight:600;font-size:16px;">${escape(p.amountFormatted)}</td></tr>
</table>`,
      p.reason
        ? `<p style="margin:0 0 12px 0;color:#475569;font-size:13px;"><strong>Reason:</strong> ${escape(p.reason)}</p>`
        : '',
      p.refundedBy
        ? `<p style="margin:0 0 12px 0;color:#64748b;font-size:12px;">Refunded by ${escape(p.refundedBy)}</p>`
        : '',
      emailDivider(),
      `<p style="margin:0;color:#64748b;font-size:12px;">Keep this receipt for your records. The original payment receipt is also retained for your reference.</p>`,
    ].join('');

    return {
      subject,
      html: wrapEmail({
        brand: p.brand,
        preheader: `Refund ${p.receiptNumber} · ${p.amountFormatted}`,
        body,
      }),
      text: [
        `Refund issued.`,
        ``,
        `${p.schoolName} has recorded the following refund for ${p.studentName}.`,
        ``,
        `Refund receipt:   ${p.receiptNumber}`,
        p.originalReceiptNumber ? `Reverses receipt: ${p.originalReceiptNumber}` : '',
        `Date:             ${friendlyDate}`,
        `Student:          ${p.studentName}`,
        `Amount refunded:  ${p.amountFormatted}`,
        p.reason ? `\nReason: ${p.reason}` : '',
        p.refundedBy ? `\nRefunded by ${p.refundedBy}` : '',
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
