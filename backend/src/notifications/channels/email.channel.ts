import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannel as Channel } from '@prisma/client';
import {
  CircuitBreaker,
  CircuitOpenError,
} from '../../common/resilience/circuit-breaker';
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
  /**
   * Phase 22 — circuit breaker around the email provider.
   *
   * Tuning:
   *   • failureThreshold: 5 — five consecutive provider failures.
   *     Email transport blips a few times during normal operation
   *     (transient SMTP timeouts), so we don't trip on the first
   *     blip. Five is an empirical "this is broken" threshold.
   *   • resetAfterMs: 30s — short cooldown. Email isn't latency-
   *     sensitive (queued anyway), so a fast probe-and-recover
   *     beats a long fast-fail window where every email gets
   *     SKIPPED.
   *   • halfOpenSuccessesToClose: 1 — one good probe is enough.
   *     The provider is either back or it isn't.
   */
  readonly circuit = new CircuitBreaker({
    name: 'email',
    failureThreshold: 5,
    resetAfterMs: 30_000,
  });

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
      const result = await this.circuit.run(() =>
        this.provider.send({
          to: input.recipient,
          from,
          subject: input.rendered.subject!,
          html: input.rendered.html!,
          text: input.rendered.text!,
        }),
      );
      return {
        status: 'SENT',
        providerMessageId: result.providerMessageId,
      };
    } catch (e) {
      // Phase 22 — distinguish breaker fast-fail from upstream
      // failure. SKIPPED is the right shape for fast-fails because
      // we never tried; counting these as FAILED would skew the
      // dispatcher's health probe.
      if (e instanceof CircuitOpenError) {
        return {
          status: 'SKIPPED',
          errorMessage: `Email circuit OPEN — provider quarantined. Will retry after cooldown.`,
        };
      }
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
