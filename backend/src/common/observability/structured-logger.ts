import {
  ConsoleLogger,
  Injectable,
  LoggerService,
  Scope,
} from '@nestjs/common';
import { RequestContext } from './request-context';

// ---------------------------------------------------------------------------
// StructuredLogger — Phase 22.
//
// A Nest LoggerService that emits one JSON object per log line when
// `LOG_FORMAT=json`. Falls back to the colourised pretty-printer
// (Nest's stock ConsoleLogger) for local dev. Drop-in replacement —
// every existing `new Logger('Foo').log(...)` call works without
// changes; only the output format changes.
//
// JSON shape:
//
//   {
//     "ts":         "2026-06-01T12:34:56.789Z",
//     "level":      "log" | "error" | "warn" | "debug" | "verbose",
//     "context":    "AuthService",
//     "message":    "User logged in",
//     "requestId":  "<uuid>",       // from RequestContext when available
//     "userId":     "<uuid>",       // ditto
//     "schoolId":   "<uuid>",       // ditto
//     "route":      "POST /auth/login",
//     "stack":      "...",          // only on error()
//     "meta":       { ... }         // optional structured payload
//   }
//
// Why one line of JSON:
//   • Trivially machine-parseable. Datadog, Loki, ELK, CloudWatch all
//     ingest line-delimited JSON natively — no parser config needed.
//   • Stable schema = stable dashboards. Every line has the same keys
//     in the same shape; missing values are explicit nulls.
//   • Local dev still uses the pretty printer so iterating doesn't
//     mean staring at JSON.
//
// The Nest framework is wired to use this via `app.useLogger(new
// StructuredLogger(...))` in main.ts. Logger() instances created at
// module init still work — they go through the Nest dispatcher which
// calls back into this service.
// ---------------------------------------------------------------------------

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

@Injectable({ scope: Scope.DEFAULT })
export class StructuredLogger implements LoggerService {
  /**
   * Pretty fallback for local dev. Initialised lazily so we don't
   * pay the import cost in the JSON path.
   */
  private readonly pretty = new ConsoleLogger();
  /** True when LOG_FORMAT=json (or unset and NODE_ENV=production). */
  private readonly json: boolean;

  constructor() {
    const explicit = (process.env.LOG_FORMAT ?? '').toLowerCase();
    if (explicit === 'json') this.json = true;
    else if (explicit === 'pretty' || explicit === 'text') this.json = false;
    else this.json = process.env.NODE_ENV === 'production';
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    stack?: string,
  ): void {
    if (!this.json) {
      // Fallback: same call signature as Nest's stock logger. Pretty
      // printer handles colorisation + level highlighting in dev.
      switch (level) {
        case 'log':
          this.pretty.log(message, context);
          return;
        case 'error':
          this.pretty.error(message, stack, context);
          return;
        case 'warn':
          this.pretty.warn(message, context);
          return;
        case 'debug':
          this.pretty.debug(message, context);
          return;
        case 'verbose':
          this.pretty.verbose(message, context);
          return;
      }
    }

    // JSON mode.
    const ctx = RequestContext.current();
    // Some callers pass an Error or object as `message` — normalise.
    let text: string;
    let meta: Record<string, unknown> | undefined;
    if (message instanceof Error) {
      text = message.message;
      meta = { errorName: message.name };
      stack = stack ?? message.stack;
    } else if (typeof message === 'object' && message !== null) {
      text = (message as { message?: string }).message ?? '';
      meta = message as Record<string, unknown>;
    } else {
      text = String(message ?? '');
    }

    const line = {
      ts: new Date().toISOString(),
      level,
      context: context ?? null,
      message: text,
      requestId: ctx?.requestId ?? null,
      userId: ctx?.userId ?? null,
      schoolId: ctx?.schoolId ?? null,
      route: ctx?.route ?? null,
      method: ctx?.method ?? null,
      stack: stack ?? null,
      meta: meta ?? null,
    };

    // Use the actual stream that matches the level so log shippers
    // can route by stream (stderr → alerts, stdout → indexing).
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    try {
      stream.write(JSON.stringify(line) + '\n');
    } catch {
      // Last-resort fallback: never let a logger throw out of a
      // critical request path. Drop the line.
    }
  }
}
