import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { HealthService } from '../../health/health.service';

/**
 * Global exception filter. Two responsibilities:
 *
 *   1. Log unhandled exceptions with full context (stack, route, method,
 *      sanitized body) so a 500 in production isn't opaque. The previous
 *      version of this filter swallowed errors silently — diagnosing
 *      "500 on POST /payments" required SSH-and-tail-logs theatre.
 *
 *   2. Translate known Prisma error codes to HTTP responses with
 *      actionable messages. P2002 (unique violation), P2003 (foreign
 *      key violation), and P2025 (record not found) are common shapes
 *      that should never reach the client as bare 500s.
 *
 * What the client sees on a 500 stays generic ("Internal server error")
 * — we log the gory detail to the server, not the client. NestJS's
 * default `HttpException.getResponse()` shape is preserved for 4xx
 * responses so existing frontend error parsing keeps working.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  /**
   * `@Optional()` because the filter is also instantiated in legacy
   * tests via `new AllExceptionsFilter()` (no DI container). When
   * `health` is undefined, we silently skip recording — server logs
   * remain the source of truth, the dashboard just doesn't see the
   * event.
   */
  constructor(@Optional() private readonly health?: HealthService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message } = this.classify(exception);

    // Server-side log. We log:
    //   • 5xx + unknown errors with full stack so we can debug
    //   • 4xx as a single info line so we can see what's getting rejected
    //     without flooding logs with stack traces from validation noise.
    if (status >= 500 || !(exception instanceof HttpException)) {
      this.logger.error(
        `[${request.method} ${request.url}] ${describeMessage(message)}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Body context is usually the most useful debugging signal — log
      // it on 5xx, redacted for the obvious sensitive fields. Skipped
      // on 4xx to keep logs lean (the client gets the validation error
      // back, that's enough).
      const safeBody = redactBody(request.body);
      if (safeBody !== undefined) {
        this.logger.error(`  body: ${JSON.stringify(safeBody)}`);
      }

      // Phase 10 — feed the health dashboard's recent-errors panel.
      // Only 5xx + unhandled exceptions count toward the operator's
      // "is something on fire?" view. 4xx is user error, not server
      // health.
      if (this.health) {
        this.health.recordError({
          status,
          method: request.method,
          route: request.url,
          message: describeMessage(message),
        });
      }
    } else if (status >= 400) {
      this.logger.warn(
        `[${request.method} ${request.url}] ${status} ${describeMessage(message)}`,
      );
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }

  /**
   * Map an exception to (status, message). Known shapes:
   *   • HttpException — preserve status + body verbatim.
   *   • PrismaClientKnownRequestError — translate by code.
   *   • PrismaClientValidationError — almost always indicates a bug
   *     (we passed Prisma a malformed query); 500 + actionable log.
   *   • Anything else — 500 with generic public message.
   */
  private classify(exception: unknown): {
    status: number;
    message: unknown;
  } {
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), message: exception.getResponse() };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return classifyPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // Validation errors come from passing Prisma a query it can't
      // parse — usually a developer mistake. Don't leak the raw
      // message (it includes our schema names); show a generic note
      // and log the full text.
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Database request was malformed.',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}

/**
 * Translate `PrismaClientKnownRequestError` codes to HTTP responses
 * with messages aimed at the operator (admin staff seeing the toast),
 * not the developer.
 *
 * Codes we cover:
 *   P2000  Value too long for column.
 *   P2002  Unique constraint failed.
 *   P2003  Foreign key constraint failed.
 *   P2010  Raw query failure (e.g. column doesn't exist — typically a
 *          missed migration).
 *   P2025  Record to update/connect not found.
 *
 * Anything we don't recognise stays a 500 — the operator sees a generic
 * message, the server log carries the code so we can extend over time.
 */
function classifyPrisma(e: Prisma.PrismaClientKnownRequestError): {
  status: number;
  message: unknown;
} {
  const target = (e.meta as { target?: string[] | string } | undefined)?.target;
  const fields = Array.isArray(target) ? target.join(', ') : target ?? '';

  switch (e.code) {
    case 'P2000':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: `Value too long${fields ? ` for ${fields}` : ''}.`,
      };
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        message:
          fields.includes('receiptNumber')
            ? 'A receipt with that number already exists. Try again.'
            : fields.includes('clientRequestId')
              ? 'Duplicate request — this payment was already recorded.'
              : `A record with the same ${fields || 'value'} already exists.`,
      };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: `Referenced record does not exist${fields ? ` (${fields})` : ''}.`,
      };
    case 'P2010':
      // Most often: a column referenced in our schema doesn't exist
      // in the live DB. The actionable fix is `prisma migrate deploy`.
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message:
          'Database is out of sync with the application. Run pending migrations.',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        message: 'The requested record was not found.',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      };
  }
}

/**
 * Redact obvious secrets from a request body before logging. We never
 * log passwords or full auth tokens; everything else (including
 * payment payloads) is fine — operators need to see the shape that
 * triggered the error to debug it.
 */
function redactBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const SENSITIVE = new Set(['password', 'newPassword', 'token', 'authorization']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = SENSITIVE.has(k) ? '<redacted>' : v;
  }
  return out;
}

/** Stringify the message body for one-line logs. */
function describeMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message && typeof message === 'object') {
    const m = message as { message?: unknown };
    if (typeof m.message === 'string') return m.message;
    return JSON.stringify(message);
  }
  return String(message);
}
