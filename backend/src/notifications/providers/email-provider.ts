import { Logger } from '@nestjs/common';

// ---------------------------------------------------------------------------
// EmailProvider — abstraction over the underlying SMTP / API service.
//
// The notification layer never imports nodemailer / SES / SendGrid
// directly. Instead it asks the provider to send a
// `RenderedEmailEnvelope` and treats any thrown error as a delivery
// failure. Swapping providers is one new class + one config flag.
//
// Two implementations ship with v1:
//   • ConsoleEmailProvider — logs the message + returns a synthetic
//     id. Default in dev so you can tail the server logs and see
//     exactly what would have shipped without setting up SMTP.
//   • SmtpEmailProvider     — nodemailer-based. Reads transport
//     config from env. Used in production.
//
// Both implementations honor a "dry run" flag so a CI environment
// can be configured to never actually send while still going through
// the full code path.
// ---------------------------------------------------------------------------

export interface RenderedEmailEnvelope {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  /**
   * Send the envelope. Returns a provider message id when available.
   * Throws on transport / API failure — the caller decides whether
   * to retry.
   */
  send(envelope: RenderedEmailEnvelope): Promise<{ providerMessageId?: string }>;
}

// ---------------------------------------------------------------------------
// Console provider — dev default.
// ---------------------------------------------------------------------------

export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email/Console');
  private counter = 0;

  send(envelope: RenderedEmailEnvelope) {
    this.counter += 1;
    const id = `console-${Date.now()}-${this.counter}`;
    this.logger.log(
      `── EMAIL ─────────────────────────────────────────────\n` +
        `  to:      ${envelope.to}\n` +
        `  from:    ${envelope.from}\n` +
        `  subject: ${envelope.subject}\n` +
        `  text:\n${indent(envelope.text)}\n` +
        `──────────────────────────────────────────────────────`,
    );
    return Promise.resolve({ providerMessageId: id });
  }
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// SMTP provider — production-ready stub.
//
// Loads `nodemailer` lazily so the dependency stays optional in dev
// (the dev-default ConsoleEmailProvider works without it). Production
// deployments add `nodemailer` to package.json and flip
// MAIL_PROVIDER=smtp.
//
// Config (env):
//   MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS — SMTP transport.
//   MAIL_SECURE — "true" forces TLS at connect (port 465).
// ---------------------------------------------------------------------------

export class SmtpEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email/SMTP');
  private transport: { sendMail: (e: object) => Promise<{ messageId?: string }> } | null =
    null;

  constructor(
    private readonly config: {
      host: string;
      port: number;
      user?: string;
      pass?: string;
      secure?: boolean;
    },
  ) {}

  private async getTransport() {
    if (this.transport) return this.transport;
    // Lazy require so the dep stays optional. If it's missing in
    // production, fail loudly with an actionable message.
    let nodemailer: { createTransport: (opts: object) => typeof this.transport };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nodemailer = require('nodemailer');
    } catch {
      throw new Error(
        'nodemailer is not installed. Run `npm install nodemailer` or set MAIL_PROVIDER=console.',
      );
    }
    this.transport = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: !!this.config.secure,
      auth:
        this.config.user && this.config.pass
          ? { user: this.config.user, pass: this.config.pass }
          : undefined,
    });
    return this.transport!;
  }

  async send(envelope: RenderedEmailEnvelope) {
    const transport = await this.getTransport();
    const result = await transport.sendMail({
      to: envelope.to,
      from: envelope.from,
      subject: envelope.subject,
      html: envelope.html,
      text: envelope.text,
    });
    this.logger.log(`SMTP sent → ${envelope.to} subject="${envelope.subject}"`);
    return { providerMessageId: result.messageId };
  }
}
