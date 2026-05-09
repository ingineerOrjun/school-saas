import {
  emailButton,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

export interface SchoolCreatedPayload {
  brand: BrandConfig;
  schoolName: string;
  /** Admin email — primary recipient. */
  adminEmail: string;
  /** Login URL the new admin can use to sign in. */
  loginUrl: string;
}

export const schoolCreatedTemplate: NotificationTemplate<SchoolCreatedPayload> = {
  key: 'platform.school_created',
  defaultChannels: ['EMAIL'],
  renderEmail: (p) => {
    const subject = `Welcome to ${p.brand.productName}, ${p.schoolName}`;
    const body = [
      emailHeading(`Welcome to ${p.brand.productName}`),
      emailParagraph(
        `${p.schoolName} has been provisioned successfully. You're signed in as the school administrator (${p.adminEmail}).`,
      ),
      emailParagraph(
        'Your next steps: add classes, invite teachers, and import students. The dashboard guides you through each one.',
      ),
      emailButton('Sign in to your dashboard', p.loginUrl),
      emailParagraph(
        'You can change your password and add more administrators from the Settings tab once you sign in.',
      ),
    ].join('');
    const html = wrapEmail({
      brand: p.brand,
      preheader: 'Your school workspace is ready.',
      body,
    });
    const text = [
      `Welcome to ${p.brand.productName}.`,
      ``,
      `${p.schoolName} has been provisioned. You're signed in as the school administrator (${p.adminEmail}).`,
      ``,
      `Sign in: ${p.loginUrl}`,
      ``,
      `Next steps: add classes, invite teachers, and import students. The dashboard guides you through each one.`,
    ].join('\n');
    return { subject, html, text };
  },
};
