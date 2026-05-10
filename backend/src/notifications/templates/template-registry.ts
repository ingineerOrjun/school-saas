// ---------------------------------------------------------------------------
// Template registry — single source of truth for every notification
// template the platform can send.
//
// Why TypeScript modules and not a DB table:
//   • Templates are part of the application's behavior — adding a
//     new transactional email is a code change with review, the same
//     way adding a new endpoint is.
//   • Versioning + preview + migration all come for free with git.
//   • A future "marketing email" surface (with non-engineer authors)
//     is the right time to add a DB-backed template editor; v1's
//     transactional set doesn't need it.
//
// Template contract:
//   Each template exports a renderer that takes a typed payload and
//   produces { subject, html, text } for email. SMS / WhatsApp will
//   add their own renderer methods on the same template module when
//   those channels light up — keeps all the copy for one event in one
//   file.
// ---------------------------------------------------------------------------

import { maintenanceDisabledTemplate } from './maintenance-disabled.template';
import { maintenanceEnabledTemplate } from './maintenance-enabled.template';
import { passwordResetTemplate } from './password-reset.template';
import { paymentReceiptTemplate } from './payment-receipt.template';
import { planChangedTemplate } from './plan-changed.template';
import { platformIncidentTemplate } from './platform-incident.template';
import { promotionCompletedTemplate } from './promotion-completed.template';
import { refundReceiptTemplate } from './refund-receipt.template';
import { schoolCreatedTemplate } from './school-created.template';
import { schoolReactivatedTemplate } from './school-reactivated.template';
import { schoolSuspendedTemplate } from './school-suspended.template';
import { securityAlertTemplate } from './security-alert.template';
import { staffInvitationTemplate } from './staff-invitation.template';
import { subscriptionExpiringTemplate } from './subscription-expiring.template';
import { subscriptionRenewedTemplate } from './subscription-renewed.template';

export interface RenderedEmail {
  subject: string;
  /** Full HTML body — wrap with `wrapEmail()` for the standard chrome. */
  html: string;
  /** Plain-text fallback for clients that block HTML. */
  text: string;
}

/**
 * Every template implements this minimal interface. Adding a new
 * channel later means adding `renderSms` / `renderInApp` here.
 */
export interface NotificationTemplate<P = unknown> {
  /** Stable key used in DB and at the call site. */
  key: string;
  /** Default channels to fan out to when none specified at enqueue time. */
  defaultChannels: ReadonlyArray<'EMAIL' | 'IN_APP'>;
  /** Render the email body for `payload`. Returns null if email is N/A. */
  renderEmail?: (payload: P) => RenderedEmail | null;
  /** Render an in-app card (title + body markdown). */
  renderInApp?: (payload: P) => { title: string; body: string };
}

// ---------------------------------------------------------------------------
// Registry. Adding a new template:
//   1. Drop a `<your-template>.template.ts` next to the others.
//   2. Import it here.
//   3. Add it to TEMPLATES.
// ---------------------------------------------------------------------------

export const TEMPLATES: Record<string, NotificationTemplate<any>> = {
  [maintenanceDisabledTemplate.key]: maintenanceDisabledTemplate,
  [maintenanceEnabledTemplate.key]: maintenanceEnabledTemplate,
  [passwordResetTemplate.key]: passwordResetTemplate,
  [paymentReceiptTemplate.key]: paymentReceiptTemplate,
  [planChangedTemplate.key]: planChangedTemplate,
  [platformIncidentTemplate.key]: platformIncidentTemplate,
  [promotionCompletedTemplate.key]: promotionCompletedTemplate,
  [refundReceiptTemplate.key]: refundReceiptTemplate,
  [schoolCreatedTemplate.key]: schoolCreatedTemplate,
  [schoolReactivatedTemplate.key]: schoolReactivatedTemplate,
  [schoolSuspendedTemplate.key]: schoolSuspendedTemplate,
  [securityAlertTemplate.key]: securityAlertTemplate,
  [staffInvitationTemplate.key]: staffInvitationTemplate,
  [subscriptionExpiringTemplate.key]: subscriptionExpiringTemplate,
  [subscriptionRenewedTemplate.key]: subscriptionRenewedTemplate,
};

export function getTemplate<P = unknown>(
  key: string,
): NotificationTemplate<P> | undefined {
  return TEMPLATES[key] as NotificationTemplate<P> | undefined;
}
