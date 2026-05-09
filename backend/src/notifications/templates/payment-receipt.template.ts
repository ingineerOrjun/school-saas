import {
  emailDivider,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface PaymentReceiptPayload {
  brand: BrandConfig;
  /** Recipient email — typically a parent on file. */
  recipientEmail: string;
  schoolName: string;
  studentName: string;
  /** Auto-generated receipt number (RCPT-YYYY-NNNN). */
  receiptNumber: string;
  /** Amount in the school's currency, raw number; rendered with the
   *  school-side `formatCurrency` analogue. */
  amount: number;
  /** Pre-formatted currency string (e.g. "रु. 12,345.00") so the
   *  email doesn't need to know the school's locale rules. */
  amountFormatted: string;
  /** Payment method enum value (CASH / BANK / ESEWA / OTHER). */
  method: string;
  /** ISO date the payment was recorded. */
  paidAt: string;
  /** Optional fee description ("Term 1 Tuition", "May Bus Fee", etc.). */
  feeDescription?: string;
  /** Optional cashier line for "Received by Alice (alice@school)". */
  receivedBy?: string;
}

export const paymentReceiptTemplate: NotificationTemplate<PaymentReceiptPayload> = {
  key: 'school.payment_receipt',
  defaultChannels: ['EMAIL'],
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Payment receipt ${p.receiptNumber}`;
    const friendlyDate = new Date(p.paidAt).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const body = [
      emailHeading('Payment received'),
      emailParagraph(
        `Thank you. ${p.schoolName} has recorded the following payment for ${p.studentName}.`,
      ),
      // Receipt block — a definition list rendered as a borderless
      // table for client compatibility.
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;width:100%;font-size:13px;">
  <tr><td style="padding:6px 0;color:#64748b;width:140px;">Receipt #</td><td style="padding:6px 0;font-family:Menlo,Monaco,monospace;color:#0f172a;">${escape(p.receiptNumber)}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Date</td><td style="padding:6px 0;color:#0f172a;">${escape(friendlyDate)}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Student</td><td style="padding:6px 0;color:#0f172a;">${escape(p.studentName)}</td></tr>
  ${p.feeDescription ? `<tr><td style="padding:6px 0;color:#64748b;">For</td><td style="padding:6px 0;color:#0f172a;">${escape(p.feeDescription)}</td></tr>` : ''}
  <tr><td style="padding:6px 0;color:#64748b;">Method</td><td style="padding:6px 0;color:#0f172a;">${escape(p.method)}</td></tr>
  <tr><td style="padding:8px 0;border-top:1px solid #e2e8f0;color:#0f172a;font-weight:600;">Amount</td><td style="padding:8px 0;border-top:1px solid #e2e8f0;color:#0f172a;font-weight:600;font-size:16px;">${escape(p.amountFormatted)}</td></tr>
</table>`,
      p.receivedBy
        ? `<p style="margin:0 0 12px 0;color:#64748b;font-size:12px;">Received by ${escape(p.receivedBy)}</p>`
        : '',
      emailDivider(),
      `<p style="margin:0;color:#64748b;font-size:12px;">Keep this receipt for your records. For questions, contact ${escape(p.schoolName)} or reply to this email.</p>`,
    ].join('');

    const html = wrapEmail({
      brand: p.brand,
      preheader: `Receipt ${p.receiptNumber} · ${p.amountFormatted}`,
      body,
    });

    const text = [
      `Payment received.`,
      ``,
      `${p.schoolName} has recorded the following payment for ${p.studentName}.`,
      ``,
      `Receipt #:  ${p.receiptNumber}`,
      `Date:       ${friendlyDate}`,
      `Student:    ${p.studentName}`,
      p.feeDescription ? `For:        ${p.feeDescription}` : '',
      `Method:     ${p.method}`,
      `Amount:     ${p.amountFormatted}`,
      p.receivedBy ? `\nReceived by ${p.receivedBy}` : '',
      ``,
      `Keep this receipt for your records.`,
    ]
      .filter(Boolean)
      .join('\n');

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
