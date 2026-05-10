import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestContext } from './request-context';

// ---------------------------------------------------------------------------
// RequestIdMiddleware — Phase 22.
//
// Seeds the RequestContext for every HTTP request and echoes the
// correlation id back as `x-request-id` so the client (and any
// downstream load balancer / log aggregator) can join logs by it.
//
// Order matters:
//   This middleware must run BEFORE every other middleware/guard so
//   that the rest of the request pipeline (auth, throttler, metrics,
//   controllers, services) sees a populated context.
//
// Inbound `x-request-id` honoured:
//   When the client (or an upstream proxy) supplied an id, we trust
//   it. This lets a long-running request from a frontend operation
//   (e.g. "promote students") propagate one id across multiple
//   backend round-trips. Generated UUIDs only fire when the inbound
//   header is missing or malformed.
//
// Bound length:
//   Trust but don't over-trust — clamp inbound ids to 128 chars and
//   strip whitespace. A misconfigured upstream could otherwise bloat
//   every log line.
// ---------------------------------------------------------------------------

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 128;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId = sanitizeRequestId(candidate) ?? randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);

    RequestContext.run(
      {
        requestId,
        method: req.method,
        startedAt: new Date().toISOString(),
      },
      () => next(),
    );
  }
}

function sanitizeRequestId(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_REQUEST_ID_LENGTH) return null;
  // Allow alphanumerics, hyphens, underscores. Anything else is
  // probably an injection attempt — discard and generate fresh.
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}
