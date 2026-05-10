import { emailHeading, emailParagraph, wrapEmail, type BrandConfig } from './layout';
import type { NotificationTemplate } from './template-registry';

export interface StaffInvitationPayload {
  brand: BrandConfig;
  acceptUrl: string;
  email: string;
  role: string;
  displayName: string | null;
  expiresAt: string;
}

export const staffInvitationTemplate: NotificationTemplate<StaffInvitationPayload> =
  {
    key: 'staff.invitation',
    defaultChannels: ['EMAIL'],
    renderEmail: (p) => {
      const subject = `You're invited to join ${p.brand.productName}`;
      const friendlyExpiry = new Date(p.expiresAt).toLocaleDateString(undefined, {
        dateStyle: 'long',
      });
      const greeting = p.displayName ? `Hi ${p.displayName.split(' ')[0]},` : 'Hi,';
      const html = [
        emailHeading('You have a new invitation'),
        emailParagraph(
          `${greeting} an admin has invited you to join ${p.brand.productName} as a ${p.role}.`,
        ),
        emailParagraph(
          'Click the button below to set your password and activate your account.',
        ),
        `<p style="margin:20px 0;">
           <a href="${p.acceptUrl}" style="background:#0f172a;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Accept invitation</a>
         </p>`,
        emailParagraph(
          `If the button doesn't work, paste this link into your browser:`,
        ),
        `<p style="margin:0 0 16px 0;font-family:monospace;font-size:11px;color:#475569;word-break:break-all;">${p.acceptUrl}</p>`,
        `<p style="margin:0;color:#64748b;font-size:12px;">This invitation expires on ${friendlyExpiry}.</p>`,
      ].join('');
      return {
        subject,
        html: wrapEmail({
          brand: p.brand,
          preheader: `Activate your ${p.brand.productName} account`,
          body: html,
        }),
        text: [
          `You're invited to join ${p.brand.productName} as a ${p.role}.`,
          ``,
          `Click the link to activate your account:`,
          p.acceptUrl,
          ``,
          `This invitation expires on ${friendlyExpiry}.`,
        ].join('\n'),
      };
    },
  };
