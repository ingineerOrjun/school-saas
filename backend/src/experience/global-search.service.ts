import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// GlobalSearchService — Phase 24 Section 2.
//
// One endpoint, many entities. Powers the Cmd+K command palette's
// "search" tab — a single keystroke against the user's tenant pulls
// students + teachers + guardians + payments + exams + classes in
// one round-trip.
//
// Ranking:
//   We sort within each entity bucket by a simple weight:
//     1. Exact symbolNumber / phone match (any entity)  → 100
//     2. Exact email                                     → 90
//     3. Field startsWith query                          → 70
//     4. Field contains query (case-insensitive)         → 40
//
//   The frontend presents groups in a fixed order (students, teachers,
//   guardians, payments, exams, classes). Inside each group, higher
//   weight wins — so an exact symbol-number hit always sits at the top.
//
// Tenant isolation:
//   Every query filters by `schoolId` from the authenticated user.
//   No cross-tenant leakage even if a SUPER_ADMIN happens to call.
//
// Role-aware:
//   TEACHER searches see students + classes only (teachers don't need
//   payments/guardians; the surface stays minimal). ADMIN sees
//   everything.
//
// Limits:
//   8 results per group. The palette doesn't paginate — refining the
//   query is the contract. Total request is bounded at ~50 rows
//   regardless of database size.
// ---------------------------------------------------------------------------

const PER_GROUP_LIMIT = 8;

export interface SearchHit {
  /** Stable identifier — the entity's row id. */
  id: string;
  /** Primary line shown in the palette. */
  primary: string;
  /** Optional secondary line (e.g. "Class 5 · Section A"). */
  secondary: string | null;
  /** Frontend route to open when the operator picks the row. */
  href: string;
  /** Computed ranking score — higher is better. */
  score: number;
}

export interface GlobalSearchResult {
  query: string;
  generatedAt: string;
  groups: {
    students: SearchHit[];
    teachers: SearchHit[];
    guardians: SearchHit[];
    payments: SearchHit[];
    exams: SearchHit[];
    classes: SearchHit[];
  };
  /** True when at least one bucket returned anything. */
  hasResults: boolean;
}

@Injectable()
export class GlobalSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(input: {
    schoolId: string;
    role: Role;
    q: string;
  }): Promise<GlobalSearchResult> {
    const q = input.q.trim();
    const empty: GlobalSearchResult = {
      query: q,
      generatedAt: new Date().toISOString(),
      groups: {
        students: [],
        teachers: [],
        guardians: [],
        payments: [],
        exams: [],
        classes: [],
      },
      hasResults: false,
    };
    if (q.length < 2) return empty;

    const teacherScope = input.role === Role.TEACHER;

    // Fan out in parallel. Bounded queries: every findMany has `take`.
    const [students, teachers, guardians, payments, exams, classes] =
      await Promise.all([
        this.searchStudents(input.schoolId, q),
        teacherScope
          ? Promise.resolve<SearchHit[]>([])
          : this.searchTeachers(input.schoolId, q),
        teacherScope
          ? Promise.resolve<SearchHit[]>([])
          : this.searchGuardians(input.schoolId, q),
        teacherScope
          ? Promise.resolve<SearchHit[]>([])
          : this.searchPayments(input.schoolId, q),
        this.searchExams(input.schoolId, q),
        this.searchClasses(input.schoolId, q),
      ]);

    const result: GlobalSearchResult = {
      query: q,
      generatedAt: new Date().toISOString(),
      groups: {
        students,
        teachers,
        guardians,
        payments,
        exams,
        classes,
      },
      hasResults:
        students.length +
          teachers.length +
          guardians.length +
          payments.length +
          exams.length +
          classes.length >
        0,
    };
    return result;
  }

  // -------------------------------------------------------------------------
  // Per-entity searches
  // -------------------------------------------------------------------------

  private async searchStudents(
    schoolId: string,
    q: string,
  ): Promise<SearchHit[]> {
    const rows = await this.prisma.student.findMany({
      where: {
        schoolId,
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { symbolNumber: { contains: q, mode: 'insensitive' } },
          { contactNumber: { contains: q, mode: 'insensitive' } },
          { parentName: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: PER_GROUP_LIMIT * 2, // overfetch then re-rank
      include: {
        class: { select: { name: true } },
        section: { select: { name: true } },
      },
      orderBy: { firstName: 'asc' },
    });
    return rows
      .map((s) => ({
        id: s.id,
        primary: `${s.firstName} ${s.lastName}`.trim(),
        secondary: [
          s.symbolNumber ? `#${s.symbolNumber}` : null,
          s.class?.name,
          s.section?.name,
          s.contactNumber || null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
        href: `/students/${s.id}`,
        score:
          score(s.symbolNumber ?? '', q, 100) ||
          score(s.contactNumber ?? '', q, 100) ||
          score(`${s.firstName} ${s.lastName}`, q, 70) ||
          score(s.parentName ?? '', q, 40),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_GROUP_LIMIT);
  }

  private async searchTeachers(
    schoolId: string,
    q: string,
  ): Promise<SearchHit[]> {
    const rows = await this.prisma.teacher.findMany({
      where: {
        schoolId,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
        ],
      },
      take: PER_GROUP_LIMIT * 2,
      include: { user: { select: { email: true } } },
      orderBy: { name: 'asc' },
    });
    return rows
      .map((t) => ({
        id: t.id,
        primary: t.name,
        secondary: t.user?.email ?? null,
        href: `/teachers/${t.id}`,
        score:
          score(t.user?.email ?? '', q, 90) || score(t.name, q, 70),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_GROUP_LIMIT);
  }

  private async searchGuardians(
    schoolId: string,
    q: string,
  ): Promise<SearchHit[]> {
    const rows = await this.prisma.guardian.findMany({
      where: {
        schoolId,
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: PER_GROUP_LIMIT * 2,
      orderBy: { fullName: 'asc' },
    });
    return rows
      .map((g) => ({
        id: g.id,
        primary: g.fullName,
        secondary: [g.email, g.phone, g.relationship]
          .filter(Boolean)
          .join(' · ') || null,
        href: `/guardians/${g.id}`,
        score:
          score(g.phone ?? '', q, 100) ||
          score(g.email ?? '', q, 90) ||
          score(g.fullName, q, 70),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_GROUP_LIMIT);
  }

  private async searchPayments(
    schoolId: string,
    q: string,
  ): Promise<SearchHit[]> {
    // Payment searches are usually by receipt number (the slip the
    // parent brings) or student name. We accept either.
    const rows = await this.prisma.payment.findMany({
      where: {
        schoolId,
        OR: [
          { receiptNumber: { contains: q, mode: 'insensitive' } },
          {
            student: {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { symbolNumber: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
        ],
      },
      take: PER_GROUP_LIMIT * 2,
      orderBy: { createdAt: 'desc' },
      include: {
        student: { select: { firstName: true, lastName: true, symbolNumber: true } },
      },
    });
    return rows
      .map((p) => ({
        id: p.id,
        primary: `Receipt ${p.receiptNumber ?? p.id.slice(0, 8)} — ${p.amount.toLocaleString('en-IN')}`,
        secondary: p.student
          ? `${p.student.firstName} ${p.student.lastName}`.trim()
          : null,
        href: `/fees?paymentId=${p.id}`,
        score:
          score(p.receiptNumber ?? '', q, 100) ||
          score(
            `${p.student?.firstName ?? ''} ${p.student?.lastName ?? ''}`,
            q,
            70,
          ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_GROUP_LIMIT);
  }

  private async searchExams(
    schoolId: string,
    q: string,
  ): Promise<SearchHit[]> {
    const rows = await this.prisma.exam.findMany({
      where: {
        schoolId,
        name: { contains: q, mode: 'insensitive' },
      },
      take: PER_GROUP_LIMIT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((e) => ({
      id: e.id,
      primary: e.name,
      secondary: e.createdAt.toLocaleDateString(),
      href: `/exams/${e.id}`,
      score: score(e.name, q, 70),
    }));
  }

  private async searchClasses(
    schoolId: string,
    q: string,
  ): Promise<SearchHit[]> {
    const rows = await this.prisma.class.findMany({
      where: {
        schoolId,
        name: { contains: q, mode: 'insensitive' },
      },
      take: PER_GROUP_LIMIT,
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      primary: c.name,
      secondary: null,
      href: `/classes/${c.id}`,
      score: score(c.name, q, 70),
    }));
  }
}

// ---------------------------------------------------------------------------
// Scoring helper
// ---------------------------------------------------------------------------

/**
 * Returns a score for `field` matching `q`. `weight` is the bonus
 * for an exact match; partial matches scale down.
 *
 *   exact match (case-insensitive) → weight + 30
 *   startsWith                     → weight
 *   contains                       → weight - 30
 *   no match                       → 0
 *
 * Both inputs are normalised (trim + lower) before comparison.
 */
function score(field: string, q: string, weight: number): number {
  const f = field.trim().toLowerCase();
  const needle = q.trim().toLowerCase();
  if (f.length === 0 || needle.length === 0) return 0;
  if (f === needle) return weight + 30;
  if (f.startsWith(needle)) return weight;
  if (f.includes(needle)) return Math.max(weight - 30, 1);
  return 0;
}
