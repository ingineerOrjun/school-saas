import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannel as Channel } from '@prisma/client';
import { EMAIL_PROVIDER } from '../providers/email-provider.token';
import type { EmailProvider } from '../providers/email-provider.token';
import {
  NotificationChannelHandler,
  NotificationDispatchInput,
  NotificationDispatchResult,
} from './notification-channel';

// ---------------------------------------------------------------------------
// EmailChannel — bridges NotificationService and the EmailProvider.
//
// Reads `MAIL_FROM` from config so a single env var controls the
// "From" address for every email the platform sends. The renderer
// has already produced subject/html/text by the time we get here;
// the channel's only job is to envelope them and ask the provider
// to ship.
// ---------------------------------------------------------------------------

@Injectable()
export class EmailChannel implements NotificationChannelHandler {
  channel: Channel = 'EMAIL';
  private readonly logger = new Logger('Notification/EmailChannel');

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly config: ConfigService,
  ) {}

  async send(
    input: NotificationDispatchInput,
  ): Promise<NotificationDispatchResult> {
    if (!input.rendered.subject || !input.rendered.html || !input.rendered.text) {
      // Template didn't produce an email body — skip rather than
      // failing. Some templates may not implement renderEmail at all
      // (an in-app-only template, for example).
      return { status: 'SKIPPED', errorMessage: 'No email body rendered.' };
    }

    const from =
      this.config.get<string>('mail.from') ?? 'noreply@example.com';

    try {
      const result = await this.provider.send({
        to: input.recipient,
        from,
        subject: input.rendered.subject,
        html: input.rendered.html,
        text: input.rendered.text,
      });
      return {
        status: 'SENT',
        providerMessageId: result.providerMessageId,
      };
    } catch (e) {
      this.logger.error(
        `Email send failed → ${input.recipient}: ${e instanceof Error ? e.message : String(e)}`,
        e instanceof Error ? e.stack : undefined,
      );
      return {
        status: 'FAILED',
        errorMessage: truncate(
          e instanceof Error ? e.message : String(e),
          1024,
        ),
      };
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
