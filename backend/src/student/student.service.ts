import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  BulkCreateStudentsDto,
  type BulkStudentInput,
} from './dto/bulk-create-students.dto';
import { Gender } from '@prisma/client';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

/** One failure entry in the bulk-import response. */
export interface BulkFailure {
  rowIndex: number;
  reason: string;
}

export interface BulkCreateResult {
  successCount: number;
  failed: BulkFailure[];
}

const studentInclude = {
  class: true,
  section: {
    include: {
      class: true,
    },
  },
} satisfies Prisma.StudentInclude;

export type StudentWithSection = Prisma.StudentGetPayload<{
  include: typeof studentInclude;
}>;

/**
 * Aggregated analytics for the Analytics Center's Student tab.
 * Composition decision: keep this co-located with StudentService rather
 * than carving out a separate AnalyticsService — the rollups are
 * student-domain logic and live alongside the source-of-truth queries.
 */
export interface StudentAnalytics {
  total: number;
  genderSplit: Array<{
    gender: 'MALE' | 'FEMALE' | 'OTHER';
    count: number;
  }>;
  /** Students per class. "Unassigned" bucket includes students with no class link at all. */
  classStrength: Array<{
    classId: string | null;
    className: string;
    count: number;
  }>;
  /** Last 12 months of admissions, oldest-first. `month` is "YYYY-MM" (AD). */
  admissionsTrend: Array<{
    month: string;
    count: number;
  }>;
  generatedAt: string;
}

@Injectable()
export class StudentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateStudentDto,
    schoolId: string,
  ): Promise<StudentWithSection> {
    if (dto.userId) {
      await this.assertUserBelongsToSchool(dto.userId, schoolId);
    }

    // Resolve class/section together so we enforce the invariant that a
    // section (if provided) lives under the provided class (if provided).
    const { classId, sectionId } = await this.resolveClassAndSection(
      dto.classId,
      dto.sectionId,
      schoolId,
    );

    try {
      return await this.prisma.student.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          symbolNumber: dto.symbolNumber,
          schoolId,
          userId: dto.userId,
          classId,
          sectionId,
          // Required demographic + contact fields. ISO date strings
          // from the DTO get parsed into Date objects here so Prisma's
          // @db.Date columns get clean values.
          gender: dto.gender,
          dateOfBirth: new Date(dto.dateOfBirth),
          parentName: dto.parentName,
          contactNumber: dto.contactNumber,
          // Optional fields — `?? null` so an explicit empty string from
          // the form isn't persisted as a meaningless empty value.
          address: dto.address?.trim() ? dto.address.trim() : null,
          admissionDate: dto.admissionDate
            ? new Date(dto.admissionDate)
            : null,
        },
        include: studentInclude,
      });
    } catch (e) {
      throw this.translateUniqueViolation(e);
    }
  }

  /**
   * Bulk-import students from a parsed spreadsheet.
   *
   * Strategy — partial success by design:
   *   1. Validate every row in JS, collecting `errors[]`.
   *   2. Detect intra-payload symbolNumber duplicates (case-insensitive)
   *      and mark all but the first occurrence as failed.
   *   3. Pre-check existing symbolNumbers in DB so duplicates surface
   *      without hitting a P2002 mid-transaction.
   *   4. Resolve `className` → `classId` from a single `class.findMany`
   *      keyed by lower-cased name.
   *   5. Run the surviving valid rows in a single
   *      `prisma.$transaction([create, create, ...])`. Any DB-level
   *      error rolls the whole batch back, so the caller knows nothing
   *      partial landed; pre-validated errors are still returned.
   *
   * Returns `{ successCount, failed: [{ rowIndex, reason }] }`.
   */
  async bulkCreate(
    dto: BulkCreateStudentsDto,
    schoolId: string,
  ): Promise<BulkCreateResult> {
    const failed: BulkFailure[] = [];

    // ---- 1. Per-row validation. The DTO only checked the OUTER shape
    //          so a single malformed row doesn't kill the whole batch.
    //          All semantic rules — required fields, enum values, phone
    //          format, date validity — run here, and per-row failures
    //          go into `failed[]` while survivors move forward.
    type Norm = {
      idx: number;
      firstName: string;
      lastName: string;
      symbolNumber: string | null;
      gender: Gender;
      dateOfBirth: Date;
      parentName: string;
      contactNumber: string;
      address: string | null;
      admissionDate: Date | null;
      className: string | null;
    };
    const PHONE_RE = /^[0-9]{10}$/;
    const VALID_GENDERS = new Set<string>([
      Gender.MALE,
      Gender.FEMALE,
      Gender.OTHER,
    ]);
    const normalized: Norm[] = [];

    (dto.students as unknown[]).forEach((rawRow, idx) => {
      const fail = (reason: string) => failed.push({ rowIndex: idx, reason });
      if (!rawRow || typeof rawRow !== 'object') {
        fail('Row must be an object.');
        return;
      }
      const row = rawRow as Partial<BulkStudentInput>;

      // ---- Normalize FIRST, validate AFTER. ----------------------
      // Cleaning before checking prevents hidden duplicates ("  1001 "
      // vs "1001") and avoids false-negative enum/regex failures from
      // trailing whitespace or casing. The three spec'd rules:
      //   • trim every string
      //   • uppercase gender
      //   • normalize symbolNumber (trim, treat empty as null)
      const trim = (v: unknown): string =>
        typeof v === 'string' ? v.trim() : '';

      const firstName = trim(row.firstName);
      const lastName = trim(row.lastName);
      const parentName = trim(row.parentName);
      const contactNumber = trim(row.contactNumber);
      const address = trim(row.address);
      const className = trim(row.className) || null;
      const symbolNumber = trim(row.symbolNumber) || null;
      const genderStr =
        typeof row.gender === 'string' ? row.gender.trim().toUpperCase() : '';

      // ---- Validate ------------------------------------------------
      if (!firstName || !lastName) {
        fail('firstName and lastName are required.');
        return;
      }
      if (!VALID_GENDERS.has(genderStr)) {
        fail('gender must be MALE, FEMALE, or OTHER.');
        return;
      }
      const gender = genderStr as Gender;

      if (!row.dateOfBirth) {
        fail('dateOfBirth is required.');
        return;
      }
      const dob = new Date(row.dateOfBirth as string);
      if (Number.isNaN(dob.getTime())) {
        fail('dateOfBirth is not a valid date.');
        return;
      }

      if (!parentName) {
        fail('parentName is required.');
        return;
      }
      if (parentName.length > 120) {
        fail('parentName must be 120 characters or fewer.');
        return;
      }

      if (!PHONE_RE.test(contactNumber)) {
        fail('contactNumber must be exactly 10 digits (numbers only).');
        return;
      }

      let admissionDate: Date | null = null;
      if (row.admissionDate) {
        const d = new Date(row.admissionDate as string);
        if (Number.isNaN(d.getTime())) {
          fail('admissionDate is not a valid date.');
          return;
        }
        admissionDate = d;
      }

      if (symbolNumber && symbolNumber.length > 40) {
        fail('symbolNumber must be 40 characters or fewer.');
        return;
      }

      normalized.push({
        idx,
        firstName,
        lastName,
        symbolNumber,
        gender,
        dateOfBirth: dob,
        parentName,
        contactNumber,
        address: address || null,
        admissionDate,
        className,
      });
    });

    // ---- 2. Intra-payload symbolNumber duplicates (case-insensitive).
    //          First occurrence wins; the rest are marked failed.
    const seenSym = new Map<string, number>();
    const intraDupIdx = new Set<number>();
    for (const r of normalized) {
      if (!r.symbolNumber) continue;
      const key = r.symbolNumber.toLowerCase();
      const firstAt = seenSym.get(key);
      if (firstAt === undefined) {
        seenSym.set(key, r.idx);
      } else {
        intraDupIdx.add(r.idx);
        failed.push({
          rowIndex: r.idx,
          reason: `Duplicate symbol number "${r.symbolNumber}" in upload (also at row ${firstAt + 1}).`,
        });
      }
    }
    let candidates = normalized.filter((r) => !intraDupIdx.has(r.idx));

    // ---- 3. DB-side symbolNumber collisions. One query for all
    //          candidate symbol numbers in this school.
    const candidateSymbols = candidates
      .map((r) => r.symbolNumber)
      .filter((s): s is string => !!s);
    if (candidateSymbols.length > 0) {
      const existing = await this.prisma.student.findMany({
        where: { schoolId, symbolNumber: { in: candidateSymbols } },
        select: { symbolNumber: true },
      });
      const taken = new Set(
        existing
          .map((e) => e.symbolNumber?.toLowerCase())
          .filter((s): s is string => !!s),
      );
      const survivors: Norm[] = [];
      for (const r of candidates) {
        if (r.symbolNumber && taken.has(r.symbolNumber.toLowerCase())) {
          failed.push({
            rowIndex: r.idx,
            reason: `Symbol number "${r.symbolNumber}" already exists in this school.`,
          });
        } else {
          survivors.push(r);
        }
      }
      candidates = survivors;
    }

    // ---- 4. Class name → classId. Single round-trip indexed by
    //          lower-cased class name.
    const classNamesNeeded = [
      ...new Set(
        candidates
          .map((r) => r.className?.toLowerCase())
          .filter((s): s is string => !!s),
      ),
    ];
    const classByName = new Map<string, string>();
    if (classNamesNeeded.length > 0) {
      const rows = await this.prisma.class.findMany({
        where: { schoolId },
        select: { id: true, name: true },
      });
      for (const c of rows) {
        if (classNamesNeeded.includes(c.name.toLowerCase())) {
          classByName.set(c.name.toLowerCase(), c.id);
        }
      }
      // Anything unresolved → fail those rows.
      const survivors: Norm[] = [];
      for (const r of candidates) {
        if (r.className && !classByName.has(r.className.toLowerCase())) {
          failed.push({
            rowIndex: r.idx,
            reason: `Class "${r.className}" not found in this school.`,
          });
        } else {
          survivors.push(r);
        }
      }
      candidates = survivors;
    }

    // ---- 5. Insert survivors inside a single transaction so a
    //          mid-batch DB failure rolls everything back cleanly.
    if (candidates.length === 0) {
      return { successCount: 0, failed: sortFailures(failed) };
    }

    try {
      await this.prisma.$transaction(
        candidates.map((r) =>
          this.prisma.student.create({
            data: {
              firstName: r.firstName,
              lastName: r.lastName,
              symbolNumber: r.symbolNumber,
              schoolId,
              classId: r.className
                ? (classByName.get(r.className.toLowerCase()) ?? null)
                : null,
              gender: r.gender,
              dateOfBirth: r.dateOfBirth,
              parentName: r.parentName,
              contactNumber: r.contactNumber,
              address: r.address,
              admissionDate: r.admissionDate,
            },
            select: { id: true },
          }),
        ),
      );
      return { successCount: candidates.length, failed: sortFailures(failed) };
    } catch (e) {
      // A race condition could still produce a P2002 (some other request
      // grabbed a symbolNumber between our pre-check and the insert).
      // Roll the whole batch back and report all surviving candidates as
      // failed so the user can retry without partial data.
      const reason =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
          ? 'A symbol number collided during commit. Please retry.'
          : 'Database transaction failed; no rows were imported.';
      for (const r of candidates) {
        failed.push({ rowIndex: r.idx, reason });
      }
      return { successCount: 0, failed: sortFailures(failed) };
    }
  }

  findAll(
    schoolId: string,
    filter?: { classId?: string | null },
  ): Promise<StudentWithSection[]> {
    const classFilter = filter?.classId
      ? { classId: filter.classId }
      : filter?.classId === null
        ? { classId: null }
        : undefined;
    return this.prisma.student.findMany({
      where: { schoolId, ...classFilter },
      include: studentInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Multi-field search optimized for the cashier workspace's typeahead.
   *
   * Matches `q` (case-insensitive contains) against any of:
   *   • firstName / lastName  (the obvious one)
   *   • symbolNumber          (Nepal-style roll/admission #; cashiers
   *                            usually have this written on slips)
   *   • contactNumber         (parent's phone — what the parent gives
   *                            the cashier when picking up the receipt)
   *   • parentName            (catches "Ram Kumar's daughter")
   *
   * Returns at most `limit` rows (default 10) so the dropdown stays
   * scrollable without a virtualized list — the cashier should refine
   * the query if they're not seeing what they want.
   *
   * Empty query returns the most-recently-created students; the UI uses
   * this as the "recent students" panel before the cashier types.
   */
  search(
    schoolId: string,
    q: string,
    limit = 10,
  ): Promise<StudentWithSection[]> {
    const trimmed = q.trim();
    const cap = Math.min(50, Math.max(1, limit));

    if (trimmed.length === 0) {
      // Empty query → recent students fallback for the "no input yet"
      // dropdown state. createdAt-desc gives "students added recently"
      // which is a useful default for new schools.
      return this.prisma.student.findMany({
        where: { schoolId },
        include: studentInclude,
        orderBy: { createdAt: 'desc' },
        take: cap,
      });
    }

    return this.prisma.student.findMany({
      where: {
        schoolId,
        OR: [
          { firstName: { contains: trimmed, mode: 'insensitive' } },
          { lastName: { contains: trimmed, mode: 'insensitive' } },
          { symbolNumber: { contains: trimmed, mode: 'insensitive' } },
          { contactNumber: { contains: trimmed, mode: 'insensitive' } },
          { parentName: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      include: studentInclude,
      // Order by name for predictability — cashier's eye scans
      // alphabetically. createdAt-desc would shuffle results unhelpfully
      // when the query matches several students.
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: cap,
    });
  }

  /**
   * Aggregated student analytics for the Analytics Center's Student
   * tab. Single round-trip (one query pulls every student row,
   * minimally-projected); the rollups are computed in JS.
   *
   * Why JS rollups instead of SQL groupBy: the projection is small
   * (5 fields × ~few hundred rows for typical schools) and we need
   * THREE different rollups (by gender, by class, by admission month)
   * against the same row set. One pass-and-bucket is cheaper than
   * three round-trips, and keeps the multi-rollup logic in one place
   * where it can't drift out of sync.
   */
  async getAnalytics(schoolId: string): Promise<StudentAnalytics> {
    const students = await this.prisma.student.findMany({
      where: { schoolId },
      select: {
        id: true,
        gender: true,
        classId: true,
        sectionId: true,
        admissionDate: true,
        createdAt: true,
        class: { select: { id: true, name: true } },
        section: { select: { id: true, classId: true, class: { select: { id: true, name: true } } } },
      },
    });

    const total = students.length;

    // ----- Gender split -----
    const byGender = new Map<string, number>();
    for (const s of students) {
      byGender.set(s.gender, (byGender.get(s.gender) ?? 0) + 1);
    }
    const genderSplit = ['MALE', 'FEMALE', 'OTHER'].map((g) => ({
      gender: g as 'MALE' | 'FEMALE' | 'OTHER',
      count: byGender.get(g) ?? 0,
    }));

    // ----- Class strength -----
    // We use the student's effective class — direct `classId` if set,
    // else the section's parent classId. Students without either count
    // as "Unassigned" so the principal can see how many haven't been
    // placed yet.
    const classCounts = new Map<
      string,
      { classId: string | null; className: string; count: number }
    >();
    const UNASSIGNED_KEY = '__unassigned__';
    classCounts.set(UNASSIGNED_KEY, {
      classId: null,
      className: 'Unassigned',
      count: 0,
    });
    for (const s of students) {
      const classId = s.classId ?? s.section?.classId ?? null;
      const className = s.class?.name ?? s.section?.class?.name ?? null;
      const key = classId ?? UNASSIGNED_KEY;
      const existing = classCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        classCounts.set(key, {
          classId,
          className: className ?? 'Unknown',
          count: 1,
        });
      }
    }
    const classStrength = [...classCounts.values()]
      // Drop the "Unassigned" bucket if there are none — it's noise
      // when every student is placed. Same for "Unknown" buckets that
      // shouldn't normally exist.
      .filter((c) => c.count > 0)
      .sort((a, b) => {
        // Push Unassigned to the end so the principal scans real
        // classes first.
        if (a.classId === null) return 1;
        if (b.classId === null) return -1;
        return a.className.localeCompare(b.className);
      });

    // ----- Admissions trend (last 12 months) -----
    // Bucket by year-month. Falls back to createdAt for legacy rows
    // that pre-date the admissionDate column. The trend is exactly
    // 12 buckets so the chart renders even when there are gap months.
    const today = new Date();
    const startOfYearAgo = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1),
    );
    const monthBuckets = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCMonth(d.getUTCMonth() - i);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthBuckets.set(key, 0);
    }
    for (const s of students) {
      const ref = s.admissionDate ?? s.createdAt;
      if (ref < startOfYearAgo) continue;
      const key = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}`;
      if (monthBuckets.has(key)) {
        monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + 1);
      }
    }
    const admissionsTrend = [...monthBuckets.entries()].map(
      ([month, count]) => ({ month, count }),
    );

    return {
      total,
      genderSplit,
      classStrength,
      admissionsTrend,
      generatedAt: new Date().toISOString(),
    };
  }

  async findOne(id: string, schoolId: string): Promise<StudentWithSection> {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId },
      include: studentInclude,
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }
    return student;
  }

  async update(
    id: string,
    dto: UpdateStudentDto,
    schoolId: string,
  ): Promise<StudentWithSection> {
    const existing = await this.ensureInSchool(id, schoolId);

    if (dto.userId) {
      await this.assertUserBelongsToSchool(dto.userId, schoolId);
    }

    // Only re-resolve class/section when at least one of them is present
    // in the update payload; otherwise preserve the existing values.
    let assignmentPatch: { classId: string | null; sectionId: string | null } | null =
      null;
    if (dto.classId !== undefined || dto.sectionId !== undefined) {
      const nextClassId =
        dto.classId !== undefined ? dto.classId : existing.classId;
      const nextSectionId =
        dto.sectionId !== undefined ? dto.sectionId : existing.sectionId;
      assignmentPatch = await this.resolveClassAndSection(
        nextClassId,
        nextSectionId,
        schoolId,
      );
    }

    try {
      return await this.prisma.student.update({
        where: { id },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          symbolNumber: dto.symbolNumber,
          userId: dto.userId,
          // Apply demographic / contact fields ONLY when present in the
          // payload — undefined leaves the column alone, while explicit
          // values overwrite it.
          ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
          ...(dto.dateOfBirth !== undefined
            ? { dateOfBirth: new Date(dto.dateOfBirth) }
            : {}),
          ...(dto.parentName !== undefined
            ? { parentName: dto.parentName }
            : {}),
          ...(dto.contactNumber !== undefined
            ? { contactNumber: dto.contactNumber }
            : {}),
          ...(dto.address !== undefined
            ? { address: dto.address?.trim() ? dto.address.trim() : null }
            : {}),
          ...(dto.admissionDate !== undefined
            ? {
                admissionDate: dto.admissionDate
                  ? new Date(dto.admissionDate)
                  : null,
              }
            : {}),
          ...(assignmentPatch ?? {}),
        },
        include: studentInclude,
      });
    } catch (e) {
      throw this.translateUniqueViolation(e);
    }
  }

  /**
   * Map Prisma P2002 unique-constraint errors onto friendly responses.
   *
   * 409 Conflict (not 400 BadRequest) — the payload itself is shaped
   * correctly; it just collides with an existing row. 400 is reserved
   * for genuinely malformed input. Clients can rely on this distinction
   * to retry with a different value vs. fix their payload.
   *
   * Constraint enforced: `@@unique([schoolId, symbolNumber])` on Student.
   */
  private translateUniqueViolation(e: unknown): unknown {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') {
      return e;
    }
    const target = (e.meta?.target as string[] | undefined) ?? [];
    if (target.includes('symbolNumber')) {
      return new ConflictException(
        'That symbol number is already assigned to another student in this school.',
      );
    }
    if (target.includes('userId')) {
      return new ConflictException(
        'That user is already linked to another student.',
      );
    }
    return new ConflictException('Conflict with an existing record.');
  }

  async remove(id: string, schoolId: string): Promise<void> {
    await this.ensureInSchool(id, schoolId);
    await this.prisma.student.delete({ where: { id } });
  }

  /**
   * Returns the existing row (minimal fields) if the student belongs to
   * this school, otherwise throws NotFound. Callers use the returned row
   * to read current classId/sectionId values without a second query.
   */
  private async ensureInSchool(id: string, schoolId: string) {
    const row = await this.prisma.student.findFirst({
      where: { id, schoolId },
      select: { id: true, classId: true, sectionId: true },
    });
    if (!row) {
      throw new NotFoundException('Student not found.');
    }
    return row;
  }

  private async assertUserBelongsToSchool(
    userId: string,
    schoolId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, schoolId },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException(
        'Linked user does not belong to this school.',
      );
    }
  }

  /**
   * Validates class and section inputs and returns the canonical pair to
   * persist. If `sectionId` is provided, its class is inferred and
   * `classId` is auto-populated from it (so the FK always lines up). If
   * both are provided, the section's classId must match the supplied
   * classId — otherwise a 400 tells the caller to fix the payload.
   */
  private async resolveClassAndSection(
    classId: string | null | undefined,
    sectionId: string | null | undefined,
    schoolId: string,
  ): Promise<{ classId: string | null; sectionId: string | null }> {
    // No section, no class — unassigned student.
    if (!sectionId && !classId) {
      return { classId: null, sectionId: null };
    }

    // Only a class — verify it belongs to this school.
    if (!sectionId && classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: classId, schoolId },
        select: { id: true },
      });
      if (!klass) {
        throw new BadRequestException('Class does not belong to this school.');
      }
      return { classId, sectionId: null };
    }

    // Section is set (with or without an explicit classId). Verify
    // tenant ownership and derive classId from the section.
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId!, class: { schoolId } },
      select: { id: true, classId: true },
    });
    if (!section) {
      throw new BadRequestException(
        'Section does not belong to this school.',
      );
    }

    if (classId && classId !== section.classId) {
      throw new BadRequestException(
        'Section does not belong to the specified class.',
      );
    }

    return { classId: section.classId, sectionId: section.id };
  }
}

/**
 * Sort failures by their original row index so the response is stable
 * and the UI can highlight rows in upload order.
 */
function sortFailures(items: BulkFailure[]): BulkFailure[] {
  return [...items].sort((a, b) => a.rowIndex - b.rowIndex);
}
