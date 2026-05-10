import {
  emailDivider,
  emailHeading,
  emailParagraph,
  wrapEmail,
  type BrandConfig,
} from './layout';
import type { NotificationTemplate } from './template-registry';

// ---------------------------------------------------------------------------
// platform_incident_broadcast — fan-out template for SUPER_ADMIN
// incident announcements (Operations Center, Section 9).
//
// Three severities map to three banner tones in the UI:
//
//   INFO       — neutral. "Scheduled maintenance tonight."
//   WARNING    — amber. "Payment gateway degraded."
//   CRITICAL   — red, sticky. "Login outage in progress."
//
// Targets a single school per Notification row (the IncidentService
// fans the broadcast across schools by enqueueing one row per
// target). This keeps the Notification model unchanged AND lets the
// existing Notification Center surface incident messages in the
// per-school feed without any consumer changes.
// ---------------------------------------------------------------------------

export interface PlatformIncidentPayload {
  brand: BrandConfig;
  /** Operator-facing label shown in the email subject + in-app title. */
  headline: string;
  /** Free-text body. Operator-authored; we don't sanitize. Plain text only. */
  body: string;
  /** INFO | WARNING | CRITICAL — drives banner tone in the UI. */
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /** ISO timestamp the broadcast went out. */
  broadcastAt: string;
  /** Operator id who broadcast — surfaced in the email footer. */
  broadcastBy: string | null;
}

export const platformIncidentTemplate: NotificationTemplate<PlatformIncidentPayload> =
  {
    key: 'platform.incident_broadcast',
    // Both channels by default. Operators want the in-app banner +
    // an email trail for compliance / "did our customers see this?".
    defaultChannels: ['EMAIL', 'IN_APP'],
    renderInApp: (p) => ({
      title: `[${p.severity}] ${p.headline}`,
      body: p.body,
    }),
    renderEmail: (p) => {
      const subject = `[${p.severity}] ${p.brand.productName}: ${p.headline}`;
      const accent =
        p.severity === 'CRITICAL'
          ? '#dc2626' // red-600
          : p.severity === 'WARNING'
            ? '#f59e0b' // amber-500
            : '#3b82f6'; // blue-500
      const html = [
        `<div style="border-left:4px solid ${accent};padding:8px 0 8px 14px;margin:0 0 16px 0;">
           <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${accent};font-weight:600;">${p.severity}</div>
         </div>`,
        emailHeading(p.headline),
        emailParagraph(p.body),
        emailDivider(),
        `<p style="margin:0;color:#64748b;font-size:12px;">Broadcast at ${new Date(p.broadcastAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}.</p>`,
      ].join('');
      return {
        subject,
        html: wrapEmail({
          brand: p.brand,
          preheader: p.body.slice(0, 140),
          body: html,
        }),
        text: [
          `[${p.severity}] ${p.headline}`,
          ``,
          p.body,
          ``,
          `Broadcast at ${p.broadcastAt}.`,
        ].join('\n'),
      };
    },
  };
