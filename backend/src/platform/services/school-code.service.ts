import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// ============================================================================
// SchoolCodeService — public, platform-unique school identifier.
// ----------------------------------------------------------------------------
// Generation rules
//   • Default format: SCH-NNNN (uppercase, zero-padded to 4 digits).
//   • SCH-0001 is the lowest; sequence advances by scanning existing
//     SCH-* codes for the highest numeric suffix and incrementing.
//   • SUPER_ADMIN may override with any custom code matching
//     `^[A-Z0-9-]+$` (3–40 chars). Format examples: KTM-001,
//     EVEREST-01, NP-0042.
//
// Concurrency
//   • Two SUPER_ADMINs registering schools simultaneously could both
//     compute the same "next" code. We retry on the unique-constraint
//     violation (Prisma error code P2002) to recover. Up to
//     MAX_GENERATION_RETRIES attempts before giving up — anything
//     beyond that signals a wider problem worth surfacing.
//   • This service is NOT responsible for atomicity with the parent
//     school.create — the caller should run code generation +
//     school.create inside the same transaction so a duplicate
//     suffix race fails the whole school creation cleanly.
//
// Validation
//   • normalize(): trim + uppercase, idempotent.
//   • validate(): throws BadRequestException with a precise message
//     when the format is wrong; safe to call on user input.
//   • exists(): point-read against the unique index.
// ============================================================================

const SCHOOL_CODE_REGEX = /^[A-Z0-9-]+$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 40;
const DEFAULT_PREFIX = 'SCH';
const DEFAULT_SUFFIX_DIGITS = 4;
const MAX_GENERATION_RETRIES = 5;

@Injectable()
export class SchoolCodeService {
  private readonly logger = new Logger(SchoolCodeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Trim whitespace and uppercase. Idempotent — safe to call on
   * already-normalized input.
   */
  normalize(input: string): string {
    return input.trim().toUpperCase();
  }

  /**
   * Throws BadRequestException if the code does not match the
   * platform's school-code grammar. The message mirrors the spec's
   * "uppercase letters, numbers, and dashes" wording so the API
   * response is operator-friendly.
   */
  validate(code: string): void {
    if (typeof code !== 'string') {
      throw new BadRequestException('School ID must be a string.');
    }
    const len = code.length;
    if (len < MIN_LENGTH || len > MAX_LENGTH) {
      throw new BadRequestException(
        `School ID must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters.`,
      );
    }
    if (!SCHOOL_CODE_REGEX.test(code)) {
      throw new BadRequestException(
        'School ID must contain only uppercase letters, numbers, and dashes.',
      );
    }
    if (code.startsWith('-') || code.endsWith('-')) {
      throw new BadRequestException(
        'School ID may not start or end with a dash.',
      );
    }
    if (code.includes('--')) {
      throw new BadRequestException(
        'School ID may not contain consecutive dashes.',
      );
    }
  }

  /**
   * Returns true when a school with the given (already-normalized)
   * code exists. Use to pre-flight validation before a write — the
   * write itself is still protected by the DB unique constraint.
   */
  async exists(code: string): Promise<boolean> {
    const row = await this.prisma.school.findUnique({
      where: { schoolCode: code },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Generate the next default-format school code (SCH-NNNN).
   *
   * Scans the highest existing SCH-NNNN suffix and increments. The
   * caller should attempt the school.create immediately and call us
   * again on a P2002 (unique violation) — we don't auto-retry inside
   * the transaction because the caller owns the transactional context.
   *
   * Codes that already match SCH-NNNN but with non-default zero-pad
   * widths (e.g. SCH-1, SCH-01) are still respected — we always emit
   * a 4-digit suffix at >= max(existing+1).
   */
  async generateNextSchoolCode(): Promise<string> {
    const candidates = await this.prisma.school.findMany({
      where: { schoolCode: { startsWith: `${DEFAULT_PREFIX}-` } },
      select: { schoolCode: true },
    });
    let maxSuffix = 0;
    for (const { schoolCode } of candidates) {
      const m = /^SCH-(\d+)$/.exec(schoolCode);
      if (!m) continue;
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxSuffix) maxSuffix = n;
    }
    const next = maxSuffix + 1;
    return `${DEFAULT_PREFIX}-${String(next).padStart(DEFAULT_SUFFIX_DIGITS, '0')}`;
  }

  /**
   * Resolve the schoolCode for a school being created.
   *
   *   • If `desired` is provided: normalize, validate, ensure not
   *     taken, return.
   *   • If `desired` is omitted: generate the next default code.
   *
   * Used by AuthService.registerAdmin and any future SUPER_ADMIN
   * "create school" endpoint. Does NOT itself write to the DB —
   * the caller persists the code via school.create.
   */
  async resolveForCreate(desired?: string | null): Promise<string> {
    if (desired && desired.trim().length > 0) {
      const normalized = this.normalize(desired);
      this.validate(normalized);
      if (await this.exists(normalized)) {
        throw new ConflictException('This School ID is already assigned.');
      }
      return normalized;
    }
    return this.generateNextSchoolCode();
  }

  /**
   * Tiny helper for the "create school inside a transaction, retry on
   * unique-violation" pattern. The caller passes a function that
   * accepts the resolved code and runs the school.create + any
   * dependent inserts. We rerun with a fresh next-code if a duplicate
   * code race surfaces as P2002 on the schoolCode unique index.
   */
  async withRetryOnCollision<T>(
    desired: string | null | undefined,
    write: (code: string) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_GENERATION_RETRIES; attempt++) {
      const code = await this.resolveForCreate(desired);
      try {
        return await write(code);
      } catch (err) {
        // Only retry on a unique violation against the schoolCode
        // index. Anything else (validation, FK, generic DB error)
        // bubbles up untouched.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          isSchoolCodeUniqueViolation(err)
        ) {
          this.logger.warn(
            `[school-code] collision on attempt ${attempt + 1} (code=${code}) — retrying`,
          );
          lastErr = err;
          // If the caller supplied a fixed desired code, two retries
          // would just collide forever. Fail fast with a clearer
          // message.
          if (desired && desired.trim().length > 0) {
            throw new ConflictException(
              'This School ID is already assigned.',
            );
          }
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error('School code generation failed after multiple retries.');
  }
}

/**
 * Returns true when a P2002 row carries `schoolCode` as the offending
 * target. Prisma's `meta.target` is either `string[]` (preferred) or
 * an underlying constraint name in older drivers — we cover both.
 */
function isSchoolCodeUniqueViolation(
  err: Prisma.PrismaClientKnownRequestError,
): boolean {
  const meta = (err.meta ?? {}) as { target?: unknown };
  const target = meta.target;
  if (Array.isArray(target)) return target.includes('schoolCode');
  if (typeof target === 'string') {
    return target.includes('schoolCode') || target.includes('schools_schoolCode_key');
  }
  return false;
}
