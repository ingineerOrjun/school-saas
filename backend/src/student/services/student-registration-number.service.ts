import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// ============================================================================
// StudentRegistrationNumberService — permanent, platform-unique student
// registration number generated once at admission.
// ----------------------------------------------------------------------------
// Format
//   SCHOOLCODE-YYYY-CLASS-SERIAL
//
//   • SCHOOLCODE — School.schoolCode with dashes stripped
//                  (SCH-0001 → SCH0001).
//   • YYYY        — admission year. Caller passes `admissionDate`
//                  (preferred) or we fall back to the current year.
//   • CLASS       — normalized admitted-class code per
//                  normalizeClassCode():
//                    – numeric grades → 2-digit zero-pad ("01", "10")
//                    – named ("Nursery"→"NUR", "LKG"→"LKG", …)
//                    – fallback → first 3 alphanumeric uppercase chars
//   • SERIAL      — 4-digit zero-padded sequence per
//                  (school × admission-year × normalized class).
//
// Concurrency
//   • Two simultaneous admissions into the same (school × year × class)
//     bucket can race for the next serial. We retry on the unique-
//     constraint violation (Prisma P2002 on
//     `students_registrationNumber_key`) up to MAX_GENERATION_RETRIES
//     attempts. Each retry re-reads the highest existing serial in
//     that bucket and increments.
//
// Permanence
//   • The caller passes the result into students.create / update once.
//     Promotion, section transfer, edit, archive, unarchive — none of
//     these regenerate. The number reflects ORIGINAL admission, not
//     the student's current grade.
// ============================================================================

const MAX_GENERATION_RETRIES = 5;
const SERIAL_DIGITS = 4;

export interface GenerateInput {
  /** Tenant scope. Required so the (school, year, class) bucket is
   *  isolated and serial counters don't bleed across tenants. */
  schoolId: string;
  /**
   * Admitted class id. Resolved via Class.findFirst({id, schoolId})
   * so a class from another tenant cannot leak through.
   */
  classId: string;
  /**
   * Admission date. When omitted, falls back to "today" — the year
   * is what matters; the day is unused. Pass the user-provided
   * admissionDate when available so backdated admissions land in the
   * correct year bucket.
   */
  admissionDate?: Date | null;
}

@Injectable()
export class StudentRegistrationNumberService {
  private readonly logger = new Logger(
    StudentRegistrationNumberService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Map a free-form Class.name to the registration-number CLASS slot.
   *
   *   • If the name contains digits, extract them and zero-pad to 2:
   *       "Class 1"   → "01"
   *       "Grade 9"   → "09"
   *       "10"        → "10"
   *       "Class 12B" → "12"   (first numeric run wins)
   *   • Else compare a stripped/uppercased form against the named
   *     buckets common in Nepal / SE Asia preschools:
   *       "Nursery" / "NUR"               → "NUR"
   *       "Pre-K" / "PRE" / "Prekindergarten" → "PRE"
   *       "LKG"                           → "LKG"
   *       "UKG"                           → "UKG"
   *       "Kindergarten" / "KG" / "KIN"   → "KIN"
   *   • Else fall through: take the first 3 alphanumeric uppercase
   *     characters of the name. Guarantees a non-empty token even
   *     for unusual labels ("XYZ-Block-A" → "XYZ").
   *
   * Defensive: input must be a non-empty string. An empty / whitespace
   * name throws because there's no sane registration-code letter to
   * pick — the caller should guard the class lookup before us.
   */
  normalizeClassCode(className: string): string {
    if (typeof className !== 'string' || className.trim().length === 0) {
      throw new Error('Class name is required to derive a class code.');
    }
    // Numeric grades — first digit run wins.
    const digitMatch = className.match(/\d+/);
    if (digitMatch) {
      return digitMatch[0].padStart(2, '0');
    }
    const stripped = className
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();
    switch (stripped) {
      case 'NURSERY':
      case 'NUR':
        return 'NUR';
      case 'PREK':
      case 'PRE':
      case 'PREKINDERGARTEN':
        return 'PRE';
      case 'LKG':
        return 'LKG';
      case 'UKG':
        return 'UKG';
      case 'KINDERGARTEN':
      case 'KG':
      case 'KIN':
        return 'KIN';
    }
    // Fallback — first three alphanumeric uppercase chars. Empty
    // result is impossible because the input was non-empty AND a
    // numeric match was attempted first; if everything stripped away
    // we'd already have thrown above implicitly. Defensive cap.
    const fallback = stripped.slice(0, 3);
    if (fallback.length === 0) {
      throw new Error(
        `Class name "${className}" has no alphanumeric characters to derive a class code from.`,
      );
    }
    return fallback;
  }

  /**
   * Generate a registration number for the given (school, class,
   * admission-year) tuple. The serial is computed by reading the
   * highest existing match for the bucket and incrementing, then
   * the caller persists the result via student.create / update.
   *
   * Re-runs on a unique-constraint violation against
   * `students_registrationNumber_key` up to MAX_GENERATION_RETRIES
   * times so concurrent admissions don't crash one another.
   */
  async generate(input: GenerateInput): Promise<string> {
    const { schoolId, classId, admissionDate } = input;

    // Resolve school code + class name in one round-trip each. Both
    // lookups enforce tenant scope: a classId from another school
    // returns null and we fail fast.
    const [school, klass] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { schoolCode: true },
      }),
      this.prisma.class.findFirst({
        where: { id: classId, schoolId },
        select: { name: true },
      }),
    ]);
    if (!school) {
      throw new NotFoundException('School not found.');
    }
    if (!klass) {
      throw new NotFoundException(
        'Class not found in this school.',
      );
    }

    const schoolCodeCompact = school.schoolCode.replace(/-/g, '');
    const year = (admissionDate ?? new Date()).getUTCFullYear();
    const classCode = this.normalizeClassCode(klass.name);
    const prefix = `${schoolCodeCompact}-${year}-${classCode}-`;

    // Loop: read the highest serial in this bucket, format the next,
    // return it. The CALLER then attempts the student write; on a
    // unique-violation, the caller calls us again to recompute.
    return this.computeNextSerial(prefix);
  }

  /**
   * Batch-generate registration numbers for many would-be admissions
   * at once. Used by the bulk-import paths (StudentService.bulkCreate
   * and the CSV/JSON ImportService) to keep all rows in one
   * `$transaction([create, create, ...])`.
   *
   * Returns an array the same length as `inputs`. A slot is `null`
   * when:
   *   • the input has no classId (caller passed null), or
   *   • the resolved class doesn't belong to the input's school
   *     (the row should be reported back to the caller as failed —
   *     we don't throw because the bulk path collects all failures).
   *
   * Concurrency note:
   *   We read the DB max-serial ONCE per (school, year, class)
   *   bucket and then increment in memory across the batch. A
   *   concurrent single-student admission that lands a registration
   *   number into the same bucket between our read and the bulk
   *   insert will surface as P2002 on the bulk transaction; the
   *   caller is expected to roll back and let the operator retry
   *   (the bulk-import UX already shows a retry-friendly error).
   */
  async generateBatch(
    inputs: GenerateInput[],
  ): Promise<Array<string | null>> {
    if (inputs.length === 0) return [];

    // 1. Resolve school codes (one query per distinct schoolId).
    const schoolIds = Array.from(
      new Set(inputs.map((i) => i.schoolId)),
    );
    const schools = await this.prisma.school.findMany({
      where: { id: { in: schoolIds } },
      select: { id: true, schoolCode: true },
    });
    const schoolCodeById = new Map(
      schools.map((s) => [s.id, s.schoolCode]),
    );

    // 2. Resolve class names for every input that supplies a classId.
    //    Tenant-checked: a classId from another tenant returns no row
    //    and that input slot resolves to null.
    const classKeys = inputs
      .filter((i) => i.classId)
      .map((i) => `${i.schoolId}:${i.classId}`);
    const distinctClassKeys = Array.from(new Set(classKeys));
    const classRows = distinctClassKeys.length
      ? await this.prisma.class.findMany({
          where: {
            OR: distinctClassKeys.map((k) => {
              const [schoolId, id] = k.split(':');
              return { id, schoolId };
            }),
          },
          select: { id: true, schoolId: true, name: true },
        })
      : [];
    const classNameByKey = new Map<string, string>();
    for (const c of classRows) {
      classNameByKey.set(`${c.schoolId}:${c.id}`, c.name);
    }

    // 3. Compute (school × year × class) buckets and fetch the max
    //    serial currently in the DB for each bucket. One query per
    //    bucket — overkill for a single-bucket batch, fine for the
    //    typical heterogeneous import.
    interface Plan {
      idx: number;
      bucketKey: string | null;
      schoolCodeCompact: string;
      year: number;
      classCode: string;
    }
    const plans: Plan[] = inputs.map((input, idx) => {
      const schoolCode = schoolCodeById.get(input.schoolId);
      if (!schoolCode || !input.classId) {
        return {
          idx,
          bucketKey: null,
          schoolCodeCompact: '',
          year: 0,
          classCode: '',
        };
      }
      const className = classNameByKey.get(
        `${input.schoolId}:${input.classId}`,
      );
      if (!className) {
        return {
          idx,
          bucketKey: null,
          schoolCodeCompact: '',
          year: 0,
          classCode: '',
        };
      }
      const schoolCodeCompact = schoolCode.replace(/-/g, '');
      const year = (input.admissionDate ?? new Date()).getUTCFullYear();
      const classCode = this.normalizeClassCode(className);
      const bucketKey = `${input.schoolId}|${year}|${classCode}`;
      return { idx, bucketKey, schoolCodeCompact, year, classCode };
    });

    // 4. Per-bucket max-serial read.
    const bucketStart = new Map<string, number>();
    const distinctBuckets = Array.from(
      new Set(
        plans.map((p) => p.bucketKey).filter((k): k is string => k !== null),
      ),
    );
    for (const key of distinctBuckets) {
      // Reconstruct prefix from the first plan that uses this bucket.
      const sample = plans.find((p) => p.bucketKey === key)!;
      const prefix = `${sample.schoolCodeCompact}-${sample.year}-${sample.classCode}-`;
      const matches = await this.prisma.student.findMany({
        where: { registrationNumber: { startsWith: prefix } },
        select: { registrationNumber: true },
      });
      let max = 0;
      for (const { registrationNumber } of matches) {
        if (!registrationNumber) continue;
        const tail = registrationNumber.slice(prefix.length);
        const n = Number.parseInt(tail, 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
      bucketStart.set(key, max);
    }

    // 5. Assign serials in input order, incrementing the in-memory
    //    counter per bucket as we go.
    const result: Array<string | null> = new Array(inputs.length).fill(null);
    for (const plan of plans) {
      if (!plan.bucketKey) {
        result[plan.idx] = null;
        continue;
      }
      const next = (bucketStart.get(plan.bucketKey) ?? 0) + 1;
      bucketStart.set(plan.bucketKey, next);
      result[plan.idx] =
        `${plan.schoolCodeCompact}-${plan.year}-${plan.classCode}-` +
        String(next).padStart(SERIAL_DIGITS, '0');
    }
    return result;
  }

  /**
   * Wraps `student.create` in a retry-on-unique-violation loop so
   * concurrent admissions into the same bucket don't fail.
   *
   * The `write` callback receives the generated registration number
   * and is expected to use it directly in the student.create call. If
   * the write throws P2002 against the registrationNumber index, we
   * regenerate and retry up to MAX_GENERATION_RETRIES times.
   */
  async withRetryOnCollision<T>(
    input: GenerateInput,
    write: (registrationNumber: string) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_GENERATION_RETRIES; attempt++) {
      const registrationNumber = await this.generate(input);
      try {
        return await write(registrationNumber);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          isRegistrationNumberUniqueViolation(err)
        ) {
          this.logger.warn(
            `[student-registration] collision on attempt ${attempt + 1} ` +
              `(number=${registrationNumber}) — retrying`,
          );
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof ConflictException
      ? lastErr
      : new ConflictException(
          'Registration number generation failed after multiple retries.',
        );
  }

  /**
   * Reads the highest existing serial for the given prefix and
   * returns the next value zero-padded to SERIAL_DIGITS.
   *
   *   prefix = "SCH0001-2026-08-"
   *   existing rows: SCH0001-2026-08-0001, SCH0001-2026-08-0002
   *   → returns "SCH0001-2026-08-0003"
   *
   * Empty bucket → "...0001".
   *
   * Why a scan instead of a counter table: counters add a write hot
   * spot that needs separate cleanup on rollbacks; a scan over the
   * (schoolId, registrationNumber) index is O(log n) on the matching
   * prefix and we only run it on admission (low frequency).
   */
  private async computeNextSerial(prefix: string): Promise<string> {
    const candidates = await this.prisma.student.findMany({
      where: { registrationNumber: { startsWith: prefix } },
      select: { registrationNumber: true },
    });
    let maxSerial = 0;
    for (const { registrationNumber } of candidates) {
      if (!registrationNumber) continue;
      const tail = registrationNumber.slice(prefix.length);
      const n = Number.parseInt(tail, 10);
      if (Number.isFinite(n) && n > maxSerial) maxSerial = n;
    }
    const next = maxSerial + 1;
    return `${prefix}${String(next).padStart(SERIAL_DIGITS, '0')}`;
  }
}

/**
 * Returns true when a P2002 row carries `registrationNumber` as the
 * offending target. Same shape-tolerance as the school-code helper.
 */
function isRegistrationNumberUniqueViolation(
  err: Prisma.PrismaClientKnownRequestError,
): boolean {
  const meta = (err.meta ?? {}) as { target?: unknown };
  const target = meta.target;
  if (Array.isArray(target)) {
    return target.includes('registrationNumber');
  }
  if (typeof target === 'string') {
    return (
      target.includes('registrationNumber') ||
      target.includes('students_registrationNumber_key')
    );
  }
  return false;
}
