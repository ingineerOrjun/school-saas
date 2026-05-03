import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * One row of resolved scope for a TEACHER user. Mirrors a single
 * `TeachingAssignment`:
 *   • classId   — required; the class the teacher acts on
 *   • sectionId — when set, narrows to that specific section
 *   • subjectId — when set, gates exam writes to this subject
 */
export interface TeacherAssignment {
  classId: string;
  sectionId: string | null;
  subjectId: string | null;
}

/**
 * Resolves a TEACHER's full set of assignments and gates writes on it.
 *
 * Source of truth is the `TeachingAssignment` table — a teacher can
 * have many rows, covering multiple classes / sections / subjects.
 *
 * ADMIN users skip every check unconditionally — they're the global
 * override.
 *
 * Coverage rules used below (per assignment row):
 *   • sectionId set  → covers ONLY that section
 *   • sectionId null → covers the WHOLE class (every section under it
 *                      AND students linked directly to the class)
 *
 * "Covers" means the requested target is allowed; the union across all
 * of a teacher's assignments is the teacher's effective scope.
 */
@Injectable()
export class TeacherScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns every (class, section?, subject?) tuple the teacher is
   * assigned to. Empty array for non-teachers and unassigned teachers.
   */
  async getAssignments(user: AuthenticatedUser): Promise<TeacherAssignment[]> {
    if (user.role !== Role.TEACHER) return [];
    const teacher = await this.prisma.teacher.findFirst({
      where: { userId: user.id, schoolId: user.schoolId },
      select: { id: true },
    });
    if (!teacher) return [];
    const rows = await this.prisma.teachingAssignment.findMany({
      where: { teacherId: teacher.id, schoolId: user.schoolId },
      select: { classId: true, sectionId: true, subjectId: true },
    });
    return rows.map((r) => ({
      classId: r.classId,
      sectionId: r.sectionId,
      subjectId: r.subjectId,
    }));
  }

  /**
   * Throws 403 unless the caller is allowed to operate on the
   * requested class/section pair.
   *
   *   • ADMIN  → always allowed.
   *   • TEACHER unassigned → 403.
   *   • TEACHER → at least one assignment must "cover" the request.
   *               • assignment.sectionId set: requested.sectionId MUST match.
   *               • assignment.sectionId null: requested.classId MUST equal
   *                 assignment.classId (any section under it is fine).
   *
   * Pass whichever id(s) the caller is acting on. When marking a
   * roster, `sectionId` may be set; when targeting a whole class,
   * `classId` is set. If a teacher is bound to a section, we still
   * insist on the specific section even if the caller passes only
   * the parent classId.
   */
  async assertClassAccess(
    user: AuthenticatedUser,
    requested: { classId?: string | null; sectionId?: string | null },
  ): Promise<void> {
    if (user.role === Role.ADMIN) return;
    if (user.role !== Role.TEACHER) {
      throw new ForbiddenException(
        'Only ADMIN and TEACHER roles can perform this action.',
      );
    }

    const assignments = await this.getAssignments(user);
    if (assignments.length === 0) {
      throw new ForbiddenException(
        'You have no class assigned. Ask an admin to assign you a class first.',
      );
    }

    // When the caller passes only a sectionId, look up its parent class
    // ONCE so a class-bound assignment can still authorize the request.
    // (A teacher assigned to "Class 8" should be able to mark attendance
    // for any section of Class 8, not just be told "no, you didn't pass
    // a classId".)
    let resolvedClassId = requested.classId ?? null;
    if (!resolvedClassId && requested.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: requested.sectionId, class: { schoolId: user.schoolId } },
        select: { classId: true },
      });
      resolvedClassId = section?.classId ?? null;
    }

    const allowed = assignments.some((a) =>
      assignmentCoversTarget(a, {
        classId: resolvedClassId,
        sectionId: requested.sectionId ?? null,
      }),
    );
    if (!allowed) {
      throw new ForbiddenException(
        'You can only act on a class or section you are assigned to.',
      );
    }
  }

  /**
   * Throws 403 unless every studentId belongs to the union of the
   * teacher's assignments.
   *
   *   • ADMIN  → always allowed.
   *   • TEACHER → each student must be coverable by at least one
   *               assignment using the same coverage rules above:
   *               section-bound assignment matches student.sectionId;
   *               class-bound matches student.classId or
   *               student.section.classId.
   */
  async assertStudentsInScope(
    user: AuthenticatedUser,
    studentIds: string[],
  ): Promise<void> {
    if (user.role === Role.ADMIN) return;
    if (studentIds.length === 0) return;

    const assignments = await this.getAssignments(user);
    if (assignments.length === 0) {
      throw new ForbiddenException(
        'You have no class assigned. Ask an admin to assign you a class first.',
      );
    }

    // Build an OR clause that matches every assignment's coverage rule
    // in a single round-trip — much cheaper than fetching each student
    // individually and walking it in JS.
    const orClauses = assignments.map((a) =>
      a.sectionId
        ? { sectionId: a.sectionId }
        : {
            OR: [
              { classId: a.classId, sectionId: null },
              { section: { classId: a.classId } },
            ],
          },
    );

    const inScope = await this.prisma.student.count({
      where: {
        id: { in: studentIds },
        schoolId: user.schoolId,
        OR: orClauses,
      },
    });

    if (inScope !== studentIds.length) {
      throw new ForbiddenException(
        'One or more students are outside your assigned classes.',
      );
    }
  }

  /**
   * Strict marks-entry guard. Tighter than `assertStudentsInScope` —
   * for every (subject × student) pair in a save call the teacher must
   * own an assignment that matches:
   *
   *     assignment.classId   === student's classId
   *     AND (assignment.sectionId === student.sectionId OR BOTH null)
   *     AND assignment.subject (catalog) ↔ ExamSubject (per-exam) by NAME
   *
   * The section rule is intentionally STRICT (no class-bound row covers
   * sectioned students for marks). Attendance still uses the looser
   * rule via `assertStudentsInScope`. This matches the policy intent
   * "teachers can only enter marks for the exact (subject, class,
   * section) they were assigned to."
   *
   * SUBJECT MATCHING — name-based bridge:
   *   `ExamSubject` doesn't carry a foreign key to `Subject` yet (the
   *   linkage migration is separate). We bridge by lowercase-trimmed
   *   name within the school. Once the FK lands this method can switch
   *   to a strict id comparison without changing call sites.
   *
   * ADMINs bypass.
   */
  async assertResultsEntryAccess(
    user: AuthenticatedUser,
    input: { studentId: string; examSubjectIds: string[] },
  ): Promise<void> {
    if (user.role === Role.ADMIN) return;
    if (user.role !== Role.TEACHER) {
      throw new ForbiddenException(
        'Only ADMIN and TEACHER roles can enter results.',
      );
    }
    if (input.examSubjectIds.length === 0) return;

    // 1. Student → tenant guard + resolve effective class/section.
    const student = await this.prisma.student.findFirst({
      where: { id: input.studentId, schoolId: user.schoolId },
      select: {
        classId: true,
        sectionId: true,
        section: { select: { classId: true } },
      },
    });
    if (!student) {
      throw new ForbiddenException(
        'Student not found in your school.',
      );
    }
    const studentClassId =
      student.classId ?? student.section?.classId ?? null;
    if (!studentClassId) {
      // Student exists but has no class — admin-only fix-up case.
      throw new ForbiddenException(
        'Student is not assigned to a class — only admins can record marks.',
      );
    }
    const studentSectionId = student.sectionId ?? null;

    // 2. ExamSubjects → tenant guard + names. Verifying each id belongs
    //    to an exam in the caller's school keeps a teacher in school A
    //    from probing subject ids from school B via this endpoint.
    const uniqueIds = Array.from(new Set(input.examSubjectIds));
    const examSubjects = await this.prisma.examSubject.findMany({
      where: {
        id: { in: uniqueIds },
        exam: { schoolId: user.schoolId },
      },
      select: { id: true, name: true },
    });
    if (examSubjects.length !== uniqueIds.length) {
      throw new ForbiddenException(
        'One or more subjects do not belong to this school.',
      );
    }

    // 3. Teacher's assignments — single round-trip with the subject
    //    relation included for the name-bridge.
    const teacher = await this.prisma.teacher.findFirst({
      where: { userId: user.id, schoolId: user.schoolId },
      select: { id: true },
    });
    if (!teacher) {
      throw new ForbiddenException(
        'You have no teacher profile in this school.',
      );
    }
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: {
        teacherId: teacher.id,
        schoolId: user.schoolId,
        classId: studentClassId,
      },
      select: {
        sectionId: true,
        subject: { select: { name: true } },
      },
    });

    // 4. Filter to assignments that match the student's section under
    //    the strict rule: assignment.sectionId === studentSectionId
    //    (covers both "section-bound matches" and "both null"). Class-
    //    bound assignments paired with sectioned students do NOT count
    //    here — that's the policy.
    const matchingScope = assignments.filter(
      (a) => (a.sectionId ?? null) === studentSectionId,
    );
    if (matchingScope.length === 0) {
      throw new ForbiddenException(
        'You are not assigned to this subject/class.',
      );
    }

    // 5. Build the lowercase-trimmed name set the teacher is allowed
    //    to grade on this (class, section) tuple. Subject-less rows
    //    contribute nothing — marks entry requires an explicit subject.
    const allowedNames = new Set(
      matchingScope
        .filter((a) => a.subject !== null)
        .map((a) => a.subject!.name.toLowerCase().trim()),
    );

    // 6. Every input subject must be in the allowed set. Failing the
    //    very first one is enough — we throw with a single message
    //    rather than enumerating every offender (admin UI surfaces it).
    for (const es of examSubjects) {
      const norm = es.name.toLowerCase().trim();
      if (!allowedNames.has(norm)) {
        throw new ForbiddenException(
          'You are not assigned to this subject/class.',
        );
      }
    }
  }

  /**
   * @deprecated Superseded by `assertResultsEntryAccess` for marks
   * entry. Kept temporarily for any callers that still pass a
   * single-subject id; they should migrate.
   */
  async assertExamAccess(
    user: AuthenticatedUser,
    target: { studentId: string; subjectId?: string | null },
  ): Promise<void> {
    await this.assertResultsEntryAccess(user, {
      studentId: target.studentId,
      examSubjectIds: target.subjectId ? [target.subjectId] : [],
    });
  }

  /**
   * Bulk marks-entry guard. Looser than `assertResultsEntryAccess` —
   * a class-bound assignment (assignment.sectionId IS NULL) authorizes
   * any section of that class. Per the user spec:
   *
   *     subjectId matches
   *     AND classId matches
   *     AND (sectionId matches OR assignment.sectionId IS NULL)
   *
   * Subject matching bridges via NAME (lowercase, trimmed) since
   * `ExamSubject` doesn't FK into the `Subject` catalog yet. The
   * input `examSubjectId` refers to an `ExamSubject.id` (same shape
   * as the per-row save endpoint).
   *
   * ADMIN bypasses unconditionally.
   */
  async assertBulkMarksAccess(
    user: AuthenticatedUser,
    input: {
      classId: string;
      sectionId: string | null;
      examSubjectId: string;
    },
  ): Promise<void> {
    if (user.role === Role.ADMIN) return;
    if (user.role !== Role.TEACHER) {
      throw new ForbiddenException(
        'Only ADMIN and TEACHER roles can enter results.',
      );
    }

    // 1. Tenant-guard the ExamSubject + grab its name for the bridge.
    const examSubject = await this.prisma.examSubject.findFirst({
      where: {
        id: input.examSubjectId,
        exam: { schoolId: user.schoolId },
      },
      select: { name: true },
    });
    if (!examSubject) {
      throw new ForbiddenException(
        'Subject does not belong to this school.',
      );
    }
    const examSubjectName = examSubject.name.toLowerCase().trim();

    // 2. Resolve the teacher row.
    const teacher = await this.prisma.teacher.findFirst({
      where: { userId: user.id, schoolId: user.schoolId },
      select: { id: true },
    });
    if (!teacher) {
      throw new ForbiddenException(
        'You have no teacher profile in this school.',
      );
    }

    // 3. Pull every assignment on this class — already narrows the
    // search to the right class server-side. The section + subject
    // checks happen in JS to keep the SQL simple and the bridge
    // logic readable.
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: {
        teacherId: teacher.id,
        schoolId: user.schoolId,
        classId: input.classId,
      },
      select: {
        sectionId: true,
        subject: { select: { name: true } },
      },
    });

    // 4. A row matches when:
    //    (a) section: assignment.sectionId === input.sectionId
    //                 OR assignment.sectionId IS NULL (class-bound)
    //    (b) subject: assignment.subject.name === examSubject.name
    //                 (case-insensitive, trimmed)
    const allowed = assignments.some((a) => {
      const sectionOk =
        a.sectionId === null ||
        (a.sectionId ?? null) === input.sectionId;
      const subjectOk =
        a.subject !== null &&
        a.subject.name.toLowerCase().trim() === examSubjectName;
      return sectionOk && subjectOk;
    });

    if (!allowed) {
      throw new ForbiddenException(
        'You are not assigned to this subject/class.',
      );
    }
  }
}

/**
 * True iff a single assignment row covers the requested target.
 * Pulled out as a pure function so it's easy to unit test and reason
 * about — every callsite uses the same rule.
 */
function assignmentCoversTarget(
  assignment: TeacherAssignment,
  requested: { classId?: string | null; sectionId?: string | null },
): boolean {
  // Section-bound assignment: the request MUST name that exact section.
  // A request with only the parent classId isn't enough — the teacher
  // owns one section, not the whole class.
  if (assignment.sectionId) {
    return (
      !!requested.sectionId && requested.sectionId === assignment.sectionId
    );
  }

  // Class-bound assignment: requested classId must match. A request that
  // only carries a sectionId (without the parent classId) can still be
  // covered IF that section lives under the assigned class — but we
  // can't verify that here without a DB hit. The student-scope guard
  // covers that case. assertClassAccess is used for "list this roster"
  // calls where the caller always supplies whichever id they're using.
  return !!requested.classId && requested.classId === assignment.classId;
}
