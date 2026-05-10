import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// GuardianService — Phase 23 Section 12.
//
// Foundations only — Guardian as a contact record + many-to-many
// link to Student. Phase 24+ will add the parent portal (logins,
// dashboards, payments). Today's value: schools can record who to
// contact for which student, and the notification fan-out (when the
// portal lands) has the right shape from day one.
//
// Design rules:
//   • Guardians live at school scope — a guardian record belongs to
//     a school. A future "shared guardian across schools" extension
//     keeps the same shape but adds a join table.
//   • Many-to-many via StudentGuardianLink. A guardian can link to
//     many students (siblings); a student can link to many guardians
//     (mother + father + emergency contact).
//   • `isPrimary` on the link drives "include in default fan-out"
//     when the parent portal sends notifications. Multiple primaries
//     are fine — that's how you fan out to both parents.
// ---------------------------------------------------------------------------

export interface GuardianRow {
  id: string;
  schoolId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  notes: string | null;
  hasUserAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GuardianLinkRow {
  id: string;
  guardianId: string;
  studentId: string;
  isPrimary: boolean;
  relationship: string | null;
  createdAt: string;
}

export interface GuardianWithLinksRow extends GuardianRow {
  links: Array<
    GuardianLinkRow & {
      student: { id: string; firstName: string; lastName: string };
    }
  >;
}

@Injectable()
export class GuardianService {
  private readonly logger = new Logger(GuardianService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string): Promise<GuardianWithLinksRow[]> {
    const rows = await this.prisma.guardian.findMany({
      where: { schoolId },
      orderBy: { fullName: 'asc' },
      take: 200,
      include: {
        links: {
          include: {
            student: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    return rows.map(toWithLinks);
  }

  async get(input: { schoolId: string; guardianId: string }): Promise<GuardianWithLinksRow> {
    const row = await this.prisma.guardian.findFirst({
      where: { id: input.guardianId, schoolId: input.schoolId },
      include: {
        links: {
          include: {
            student: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Guardian not found.');
    return toWithLinks(row);
  }

  async create(input: {
    schoolId: string;
    fullName: string;
    email?: string;
    phone?: string;
    relationship?: string;
    notes?: string;
  }): Promise<GuardianRow> {
    const created = await this.prisma.guardian.create({
      data: {
        schoolId: input.schoolId,
        fullName: input.fullName.trim(),
        email: input.email?.trim().toLowerCase() ?? null,
        phone: input.phone?.trim() ?? null,
        relationship: input.relationship?.trim() ?? null,
        notes: input.notes ?? null,
      },
    });
    this.logger.log(
      `[guardians] created id=${created.id} schoolId=${input.schoolId}`,
    );
    return toRow(created);
  }

  async update(input: {
    schoolId: string;
    guardianId: string;
    fullName?: string;
    email?: string | null;
    phone?: string | null;
    relationship?: string | null;
    notes?: string | null;
  }): Promise<GuardianRow> {
    const existing = await this.prisma.guardian.findFirst({
      where: { id: input.guardianId, schoolId: input.schoolId },
    });
    if (!existing) throw new NotFoundException('Guardian not found.');
    const updated = await this.prisma.guardian.update({
      where: { id: input.guardianId },
      data: {
        fullName: input.fullName?.trim() ?? undefined,
        email: input.email !== undefined ? input.email?.trim().toLowerCase() ?? null : undefined,
        phone: input.phone !== undefined ? input.phone?.trim() ?? null : undefined,
        relationship: input.relationship !== undefined ? input.relationship?.trim() ?? null : undefined,
        notes: input.notes,
      },
    });
    return toRow(updated);
  }

  async remove(input: { schoolId: string; guardianId: string }): Promise<void> {
    const existing = await this.prisma.guardian.findFirst({
      where: { id: input.guardianId, schoolId: input.schoolId },
    });
    if (!existing) throw new NotFoundException('Guardian not found.');
    await this.prisma.guardian.delete({ where: { id: input.guardianId } });
  }

  // -------------------------------------------------------------------------
  // Link management
  // -------------------------------------------------------------------------

  async link(input: {
    schoolId: string;
    guardianId: string;
    studentId: string;
    isPrimary?: boolean;
    relationship?: string;
  }): Promise<GuardianLinkRow> {
    // Verify both belong to the same school (tenant isolation).
    const [guardian, student] = await Promise.all([
      this.prisma.guardian.findFirst({
        where: { id: input.guardianId, schoolId: input.schoolId },
        select: { id: true },
      }),
      this.prisma.student.findFirst({
        where: { id: input.studentId, schoolId: input.schoolId },
        select: { id: true },
      }),
    ]);
    if (!guardian || !student) {
      throw new NotFoundException('Guardian or student not found in this school.');
    }

    // Idempotent — upsert keeps repeated link calls a no-op.
    const link = await this.prisma.studentGuardianLink.upsert({
      where: {
        studentId_guardianId: {
          studentId: input.studentId,
          guardianId: input.guardianId,
        },
      },
      create: {
        studentId: input.studentId,
        guardianId: input.guardianId,
        schoolId: input.schoolId,
        isPrimary: input.isPrimary ?? false,
        relationship: input.relationship ?? null,
      },
      update: {
        isPrimary: input.isPrimary ?? undefined,
        relationship: input.relationship ?? undefined,
      },
    });
    return {
      id: link.id,
      guardianId: link.guardianId,
      studentId: link.studentId,
      isPrimary: link.isPrimary,
      relationship: link.relationship,
      createdAt: link.createdAt.toISOString(),
    };
  }

  async unlink(input: {
    schoolId: string;
    guardianId: string;
    studentId: string;
  }): Promise<void> {
    const link = await this.prisma.studentGuardianLink.findFirst({
      where: {
        guardianId: input.guardianId,
        studentId: input.studentId,
        schoolId: input.schoolId,
      },
    });
    if (!link) {
      throw new NotFoundException('Guardian link not found.');
    }
    await this.prisma.studentGuardianLink.delete({ where: { id: link.id } });
  }

  /** Per-student view — used by the student detail page to render
   * "Guardians" panel + add/edit affordances. */
  async listForStudent(input: {
    schoolId: string;
    studentId: string;
  }): Promise<GuardianRow[]> {
    const links = await this.prisma.studentGuardianLink.findMany({
      where: { studentId: input.studentId, schoolId: input.schoolId },
      include: { guardian: true },
    });
    return links.map((l) => toRow(l.guardian));
  }
}

function toRow(g: {
  id: string;
  schoolId: string;
  userId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GuardianRow {
  return {
    id: g.id,
    schoolId: g.schoolId,
    fullName: g.fullName,
    email: g.email,
    phone: g.phone,
    relationship: g.relationship,
    notes: g.notes,
    hasUserAccount: !!g.userId,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

function toWithLinks(
  g: Parameters<typeof toRow>[0] & {
    links: Array<{
      id: string;
      guardianId: string;
      studentId: string;
      isPrimary: boolean;
      relationship: string | null;
      createdAt: Date;
      student: { id: string; firstName: string; lastName: string };
    }>;
  },
): GuardianWithLinksRow {
  if (!g.fullName.trim()) {
    throw new BadRequestException('Guardian must have a full name.');
  }
  return {
    ...toRow(g),
    links: g.links.map((l) => ({
      id: l.id,
      guardianId: l.guardianId,
      studentId: l.studentId,
      isPrimary: l.isPrimary,
      relationship: l.relationship,
      createdAt: l.createdAt.toISOString(),
      student: l.student,
    })),
  };
}
