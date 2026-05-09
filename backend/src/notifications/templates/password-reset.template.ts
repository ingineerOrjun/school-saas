import {
  emailDivider,
  emailHeading,
  emailMonoBlock,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface PasswordResetPayload {
  brand: BrandConfig;
  /** Recipient's email — used in the greeting line. */
  email: string;
  /** The plaintext temporary password the operator generated. */
  temporaryPassword: string;
  /** Email of the SUPER_ADMIN who triggered the reset. */
  performedBy: string;
  /** Login URL the user can paste into their browser. */
  loginUrl: string;
}

export const passwordResetTemplate: NotificationTemplate<PasswordResetPayload> = {
  key: 'platform.password_reset',
  defaultChannels: ['EMAIL'],
  renderEmail: (p) => {
    const subject = `${p.brand.productName}: Your password has been reset`;
    const body = [
      emailHeading('Your password was reset'),
      emailParagraph(
        `An administrator at ${p.brand.productName} reset the password for your account (${p.email}).`,
      ),
      emailParagraph('Use this temporary password to sign in:'),
      emailMonoBlock(p.temporaryPassword),
      emailParagraph(
        'For your security, please change it immediately after signing in. This password was generated on your behalf and shared with you over email — treat it as a one-time credential.',
      ),
      `<p style="margin:0 0 12px 0;">Sign in at <a href="${p.loginUrl}" style="color:#0f172a;">${p.loginUrl}</a></p>`,
      emailDivider(),
      `<p style="margin:0;color:#64748b;font-size:12px;">If you did not expect this reset, contact ${p.brand.supportEmail} right away. Action performed by ${p.performedBy}.</p>`,
    ].join('');
    const html = wrapEmail({
      brand: p.brand,
      preheader: 'Your password has been reset by an administrator.',
      body,
    });
    const text = [
      `Your password was reset.`,
      ``,
      `An administrator at ${p.brand.productName} reset the password for your account (${p.email}).`,
      ``,
      `Temporary password: ${p.temporaryPassword}`,
      ``,
      `Sign in at: ${p.loginUrl}`,
      ``,
      `For your security, change it immediately after signing in.`,
      ``,
      `If you did not expect this reset, contact ${p.brand.supportEmail}.`,
      `Action performed by ${p.performedBy}.`,
    ].join('\n');
    return { subject, html, text };
  },
};
