import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DiscountType,
  FeeAssignment,
  FeeStructure,
  Payment,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AssignFeeDto } from './dto/assign-fee.dto';
import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdateFeeAssignmentDto } from './dto/update-fee-assignment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

export type AssignmentStatus = 'PAID' | 'PARTIAL' | 'UNPAID';

export interface FeeStructureWithClass extends FeeStructure {
  class: { id: string; name: string } | null;
}

export interface StudentFeeAssignmentRow {
  id: string;
  feeStructureId: string;
  feeStructureName: string;
  /** The pre-discount amount snapshot from the fee structure. */
  baseAmount: number;
  /** Kept for backward-compat: identical to `finalAmount`. */
  amount: number;
  /** Post-discount amount the student actually owes. */
  finalAmount: number;
  /** PERCENT | FIXED | null */
  discountType: DiscountType | null;
  /** 0–100 for PERCENT, currency for FIXED. Null when no discount. */
  discountValue: number | null;
  /** Currency amount knocked off (baseAmount − finalAmount). */
  discountAmount: number;
  dueDate: string;
  /**
   * Payments DIRECTLY linked to this assignment (stored feeAssignmentId
   * match). Does NOT include general-credit allocations.
   */
  paidDirect: number;
  /**
   * Portion of unlinked general credits that was auto-applied to this
   * fee by the oldest-first settlement rule.
   */
  paidFromCredit: number;
  /** Total paid (direct + from credit) — what shows on the dues line. */
  paid: number;
  remaining: number;
  status: AssignmentStatus;
  overdue: boolean;
  /**
   * False once any DIRECT payment has been recorded against this
   * assignment — editing the discount after money has moved would
   * silently invalidate already-issued receipts. (General-credit
   * allocations don't lock the discount because they're derivable.)
   */
  canEditDiscount: boolean;
}

export interface StudentFeesReport {
  studentId: string;
  firstName: string;
  lastName: string;
  assignments: StudentFeeAssignmentRow[];
  payments: Array<{
    id: string;
    amount: number;
    date: string;
    feeAssignmentId: string | null;
    receiptNumber: string | null;
    method: PaymentMethod | null;
    notes: string | null;
  }>;
  /** Sum of baseAmount across assignments — the pre-discount total. */
  totalBase: number;
  /** Sum of finalAmount across assignments — what is actually owed. */
  totalAssigned: number;
  /** Total amount discounted across all of this student's assignments. */
  totalDiscount: number;
  totalPaid: number;
  totalDue: number;
  /**
   * Unallocated general-credit balance — money the student has paid
   * that hasn't been consumed by any fee yet. Derived from unlinked
   * payments minus the portion auto-applied to oldest unpaid fees.
   * Always ≥ 0.
   */
  totalCredit: number;
}

export interface DuesRow {
  studentId: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
  className: string | null;
  sectionName: string | null;
  /** Sum of pre-discount base amounts across this student's assignments. */
  totalBase: number;
  /** Total amount knocked off by scholarships/discounts (totalBase − totalAssigned). */
  totalDiscount: number;
  /** Sum of POST-discount amounts owed — what "assigned" really means today. */
  totalAssigned: number;
  totalPaid: number;
  totalDue: number;
  /** Unallocated general-credit balance (≥ 0). */
  totalCredit: number;
  /** Earliest dueDate where the assignment still has a remaining balance. */
  oldestDueDate: string | null;
  /** True when any unpaid assignment's dueDate is in the past. */
  overdue: boolean;
}

/**
 * Per-fee breakdown attached to the receipt when the payment is linked
 * to a specific FeeAssignment. Null for unlinked General Credit
 * payments — those have no single fee to report against.
 */
export interface ReceiptFeeDetail {
  /** Pre-discount amount snapshot from the fee structure. */
  baseAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  /** baseAmount − finalAmount (always ≥ 0). */
  discountAmount: number;
  /** Post-discount amount the student actually owes for this fee. */
  finalAmount: number;
  /** Sum of all payments against this fee, INCLUDING the one on this receipt. */
  totalPaidOnFee: number;
  /** Portion of totalPaidOnFee that came from DIRECT linked payments. */
  paidDirectOnFee: number;
  /** Portion of totalPaidOnFee notionally drawn from General Credit via FIFO. */
  paidFromCreditOnFee: number;
  /** Remaining balance on this fee after this payment. */
  remainingOnFee: number;
}

export interface Receipt {
  paymentId: string;
  receiptNumber: string;
  date: string;
  amount: number;
  method: PaymentMethod | null;
  notes: string | null;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    symbolNumber: string | null;
    section: { name: string; className: string } | null;
  };
  feeStructure: { id: string; name: string; frequency: string } | null;
  /** Null for unlinked payments. */
  feeDetail: ReceiptFeeDetail | null;
  school: { id: string; name: string; slug: string };
  recordedAt: string;
}

@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Fee structures
  // ---------------------------------------------------------------------

  async createStructure(
    dto: CreateFeeStructureDto,
    schoolId: string,
  ): Promise<FeeStructureWithClass> {
    // If the caller scoped the fee to a class, verify that class belongs
    // to their school before creating — otherwise a forged classId could
    // leak cross-tenant.
    if (dto.classId) {
      await this.assertClassBelongsToSchool(dto.classId, schoolId);
    }
    try {
      return await this.prisma.feeStructure.create({
        data: {
          name: dto.name,
          amount: dto.amount,
          frequency: dto.frequency,
          classId: dto.classId ?? null,
          schoolId,
        },
        include: { class: { select: { id: true, name: true } } },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A fee named "${dto.name}" already exists in this school.`,
        );
      }
      throw e;
    }
  }

  listStructures(schoolId: string): Promise<FeeStructureWithClass[]> {
    return this.prisma.feeStructure.findMany({
      where: { schoolId },
      include: { class: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------
  // Assign fee to one-or-many students
  // ---------------------------------------------------------------------

  async assignFee(
    dto: AssignFeeDto,
    schoolId: string,
  ): Promise<{ created: number }> {
    // Payload sanity: can't send one half of the discount pair.
    const hasDiscountType = dto.discountType !== undefined;
    const hasDiscountValue = dto.discountValue !== undefined;
    if (hasDiscountType !== hasDiscountValue) {
      throw new BadRequestException(
        'Both discountType and discountValue are required to apply a discount.',
      );
    }
    if (dto.discountType === DiscountType.PERCENT && dto.discountValue !== undefined) {
      if (dto.discountValue < 0 || dto.discountValue > 100) {
        throw new BadRequestException(
          'A percent discount must be between 0 and 100.',
        );
      }
    }

    // Snapshot the fee amount & verify tenant ownership in one query.
    const structure = await this.prisma.feeStructure.findFirst({
      where: { id: dto.feeStructureId, schoolId },
      select: { id: true, amount: true, classId: true },
    });
    if (!structure) {
      throw new NotFoundException('Fee structure not found.');
    }

    // Verify every student belongs to the caller's school. We pull
    // classId too so we can enforce the class-scope rule below.
    const studentIds = [...new Set(dto.studentIds)];
    const students = await this.prisma.student.findMany({
      where: { id: { in: studentIds }, schoolId },
      select: { id: true, classId: true, firstName: true, lastName: true },
    });
    if (students.length !== studentIds.length) {
      throw new BadRequestException(
        'One or more students do not belong to this school.',
      );
    }

    // Class-scoped fee: reject students who aren't in that class.
    if (structure.classId) {
      const mismatched = students.filter((s) => s.classId !== structure.classId);
      if (mismatched.length > 0) {
        const names = mismatched
          .slice(0, 3)
          .map((s) => `${s.firstName} ${s.lastName}`)
          .join(', ');
        const suffix = mismatched.length > 3 ? `, +${mismatched.length - 3} more` : '';
        throw new BadRequestException(
          `This fee only applies to its assigned class. Remove: ${names}${suffix}.`,
        );
      }
    }

    const dueDate = parseDate(dto.dueDate);

    const result = await this.prisma.feeAssignment.createMany({
      data: studentIds.map((studentId) => ({
        studentId,
        feeStructureId: structure.id,
        amount: structure.amount,
        dueDate,
        discountType: dto.discountType ?? null,
        discountValue: dto.discountValue ?? null,
        schoolId,
      })),
      skipDuplicates: true,
    });
    return { created: result.count };
  }

  // ---------------------------------------------------------------------
  // Edit an existing assignment's discount
  // ---------------------------------------------------------------------

  /**
   * Mutate only the discount on an existing FeeAssignment.
   *
   * Rules:
   *   1. The assignment must belong to the caller's school (tenant guard).
   *   2. If ANY payment has been recorded against this assignment we
   *      refuse the edit with 400 — the discount is part of the frozen
   *      financial snapshot at that point. Already-issued receipts would
   *      otherwise stop reconciling with the assignment's final amount.
   *   3. If both `discountType` and `discountValue` are null (or omitted)
   *      the discount is cleared entirely.
   *   4. One without the other is rejected — matches the assignFee rule
   *      so the two paths validate identically.
   */
  async updateAssignmentDiscount(
    assignmentId: string,
    dto: UpdateFeeAssignmentDto,
    schoolId: string,
  ): Promise<FeeAssignment> {
    const assignment = await this.prisma.feeAssignment.findFirst({
      where: { id: assignmentId, schoolId },
      select: {
        id: true,
        amount: true,
        // Only need to know IF there are any payments, not their values.
        _count: { select: { payments: true } },
      },
    });
    if (!assignment) {
      throw new NotFoundException('Fee assignment not found.');
    }

    if (assignment._count.payments > 0) {
      throw new BadRequestException(
        'Cannot edit the discount on this fee — payments have already been recorded. Reverse the payments first, or leave the discount as-is.',
      );
    }

    // Normalize: treat an explicit `null` the same as "not sent".
    const typeSent = dto.discountType !== undefined && dto.discountType !== null;
    const valueSent = dto.discountValue !== undefined && dto.discountValue !== null;
    const clearingBoth =
      (dto.discountType === null || dto.discountType === undefined) &&
      (dto.discountValue === null || dto.discountValue === undefined);

    if (!clearingBoth && typeSent !== valueSent) {
      throw new BadRequestException(
        'Both discountType and discountValue are required to apply a discount.',
      );
    }
    if (typeSent && dto.discountType === DiscountType.PERCENT && valueSent) {
      const v = dto.discountValue as number;
      if (v < 0 || v > 100) {
        throw new BadRequestException(
          'A percent discount must be between 0 and 100.',
        );
      }
    }

    return this.prisma.feeAssignment.update({
      where: { id: assignmentId },
      data: {
        discountType: clearingBoth ? null : (dto.discountType as DiscountType),
        discountValue: clearingBoth ? null : (dto.discountValue as number),
      },
    });
  }

  // ---------------------------------------------------------------------
  // Student fee view
  // ---------------------------------------------------------------------

  async getStudentFees(
    studentId: string,
    schoolId: string,
  ): Promise<StudentFeesReport> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!student) throw new NotFoundException('Student not found.');

    const [assignments, payments] = await Promise.all([
      this.prisma.feeAssignment.findMany({
        where: { studentId, schoolId },
        include: {
          feeStructure: { select: { id: true, name: true } },
          payments: { select: { amount: true } },
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { studentId, schoolId },
        orderBy: { date: 'desc' },
      }),
    ]);

    // ------------------------------------------------------------------
    // Source of truth: totalCredit is the RAW sum of unlinked payments.
    // ------------------------------------------------------------------
    // We intentionally do NOT subtract "credit applied via FIFO to unpaid
    // fees" from this number. That derivation exists separately (as the
    // per-assignment `paidFromCredit` display hint), but the school-wide
    // and per-student credit balance is always the raw pool. This keeps
    // one number (unlinked payment sum) as the single source of truth
    // and avoids double-counting when credits appear in multiple views.
    // ------------------------------------------------------------------
    const today = stripTime(new Date());
    const totalCredit = payments
      .filter((p) => p.feeAssignmentId === null)
      .reduce((sum, p) => sum + p.amount, 0);

    // Derivation (display only): walk assignments oldest-first and note
    // how much of the General Credit pool notionally covers each fee's
    // remaining balance after direct payments. This populates
    // `paidFromCredit` on each row so the UI can annotate "incl. 300 credit"
    // — it does NOT change `totalCredit`, `totalDue`, or `totalPaid`.
    const rowsDraft = assignments.map((a) => {
      const base = a.amount;
      const finalAmount = applyDiscount(base, a.discountType, a.discountValue);
      const paidDirect = a.payments.reduce((sum, p) => sum + p.amount, 0);
      return { a, base, finalAmount, paidDirect };
    });
    let notionalCreditPool = totalCredit;
    const paidFromCreditById = new Map<string, number>();
    for (const { a, finalAmount, paidDirect } of rowsDraft) {
      if (notionalCreditPool <= 0) break;
      const openBalance = Math.max(0, finalAmount - paidDirect);
      if (openBalance <= 0) continue;
      const take = Math.min(notionalCreditPool, openBalance);
      paidFromCreditById.set(a.id, take);
      notionalCreditPool -= take;
    }

    const assignmentRows: StudentFeeAssignmentRow[] = rowsDraft.map(
      ({ a, base, finalAmount, paidDirect }) => {
        const paidFromCredit = paidFromCreditById.get(a.id) ?? 0;
        const paid = paidDirect + paidFromCredit;
        const remaining = Math.max(0, finalAmount - paid);
        const status: AssignmentStatus =
          remaining === 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
        const overdue = remaining > 0 && stripTime(a.dueDate) < today;
        return {
          id: a.id,
          feeStructureId: a.feeStructureId,
          feeStructureName: a.feeStructure.name,
          baseAmount: round(base, 2),
          amount: round(finalAmount, 2),
          finalAmount: round(finalAmount, 2),
          discountType: a.discountType,
          discountValue: a.discountValue,
          discountAmount: round(base - finalAmount, 2),
          dueDate: a.dueDate.toISOString().slice(0, 10),
          paidDirect: round(paidDirect, 2),
          paidFromCredit: round(paidFromCredit, 2),
          paid: round(paid, 2),
          remaining: round(remaining, 2),
          status,
          overdue,
          // Only DIRECT payments lock the discount — credit allocation
          // is derived and can be undone by recording a refund or
          // restructuring the fee. That keeps the discount editable on a
          // fee that's only "paid" from general credit so far.
          canEditDiscount: a.payments.length === 0,
        };
      },
    );

    const totalBase = assignmentRows.reduce((s, a) => s + a.baseAmount, 0);
    const totalAssigned = assignmentRows.reduce((s, a) => s + a.finalAmount, 0);
    const totalDiscount = assignmentRows.reduce((s, a) => s + a.discountAmount, 0);
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const totalDue = Math.max(0, totalAssigned - totalPaid);

    return {
      studentId: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      assignments: assignmentRows,
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        date: p.date.toISOString().slice(0, 10),
        feeAssignmentId: p.feeAssignmentId,
        receiptNumber: p.receiptNumber,
        method: p.method,
        notes: p.notes,
      })),
      totalBase: round(totalBase, 2),
      totalAssigned: round(totalAssigned, 2),
      totalDiscount: round(totalDiscount, 2),
      totalPaid: round(totalPaid, 2),
      totalDue: round(totalDue, 2),
      totalCredit: round(totalCredit, 2),
    };
  }

  // ---------------------------------------------------------------------
  // Record payment
  // ---------------------------------------------------------------------

  async recordPayment(
    dto: CreatePaymentDto,
    schoolId: string,
  ): Promise<Payment> {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found.');

    if (dto.feeAssignmentId) {
      await this.assertAssignmentBalance(
        dto.feeAssignmentId,
        schoolId,
        dto.studentId,
        dto.amount,
      );
    } else {
      // Unlinked payment — enforce against the student's total outstanding.
      await this.assertStudentBalance(dto.studentId, schoolId, dto.amount);
    }

    const year = new Date(`${dto.date}T00:00:00.000Z`).getUTCFullYear();

    // Generate receipt number with retry. Racing transactions could collide
    // on the `(schoolId, receiptNumber)` unique index; bump and retry up to
    // `MAX_ATTEMPTS` times before giving up.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const receiptNumber = await this.nextReceiptNumber(schoolId, year, attempt);
      try {
        return await this.prisma.payment.create({
          data: {
            studentId: dto.studentId,
            amount: dto.amount,
            date: parseDate(dto.date),
            feeAssignmentId: dto.feeAssignmentId ?? null,
            schoolId,
            receiptNumber,
            notes: dto.notes ?? null,
            method: dto.method ?? null,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          attempt < MAX_ATTEMPTS - 1
        ) {
          continue;
        }
        throw e;
      }
    }
    // Unreachable — the loop above either returns or throws.
    throw new Error('Failed to generate a unique receipt number.');
  }

  /**
   * Edit a payment's annotations. Scope is deliberately tight:
   *   • Allowed to change: `notes`, `method`.
   *   • NOT allowed to change: amount, date, receiptNumber (frozen
   *     snapshot of the transaction — receipts already issued depend
   *     on these staying constant).
   *   • NOT allowed to change: feeAssignmentId when the payment was
   *     originally recorded as General Credit (null). That transition
   *     would silently rewrite financial history: the receipt was
   *     issued to "General Credit" and any reports that already
   *     FIFO-allocated this credit to other fees would disagree with
   *     the new explicit link. Credit history must stay immutable.
   *
   * The guard returns 400 with a clear message rather than silently
   * ignoring the feeAssignmentId field, so API callers learn the rule.
   */
  async updatePayment(
    id: string,
    dto: UpdatePaymentDto,
    schoolId: string,
  ): Promise<Payment> {
    const existing = await this.prisma.payment.findFirst({
      where: { id, schoolId },
      select: { id: true, feeAssignmentId: true },
    });
    if (!existing) {
      throw new NotFoundException('Payment not found.');
    }

    // Immutability guard: a General Credit payment can never gain a
    // fee link through this endpoint.
    if (
      dto.feeAssignmentId !== undefined &&
      existing.feeAssignmentId === null &&
      dto.feeAssignmentId !== null
    ) {
      throw new BadRequestException(
        'Cannot reassign a General Credit payment to a specific fee. Credit history must remain immutable.',
      );
    }

    // Only notes + method are actually persisted. We intentionally
    // ignore any feeAssignmentId in the payload (it existed on the DTO
    // purely for the guard above). `undefined` leaves the column alone;
    // explicit `null` clears it (for notes/method that's meaningful).
    return this.prisma.payment.update({
      where: { id },
      data: {
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
      },
    });
  }

  /**
   * Find the next receipt number for (schoolId, year). Uses max existing +
   * 1 + attempt (so retries produce different candidates on race collisions).
   */
  private async nextReceiptNumber(
    schoolId: string,
    year: number,
    bump = 0,
  ): Promise<string> {
    const prefix = `RCPT-${year}-`;
    const latest = await this.prisma.payment.findFirst({
      where: { schoolId, receiptNumber: { startsWith: prefix } },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true },
    });
    let next = 1;
    if (latest?.receiptNumber) {
      const tail = latest.receiptNumber.slice(prefix.length);
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${String(next + bump).padStart(4, '0')}`;
  }

  private async assertAssignmentBalance(
    feeAssignmentId: string,
    schoolId: string,
    studentId: string,
    incomingAmount: number,
  ): Promise<void> {
    const assignment = await this.prisma.feeAssignment.findFirst({
      where: { id: feeAssignmentId, schoolId, studentId },
      include: { payments: { select: { amount: true } } },
    });
    if (!assignment) {
      throw new BadRequestException(
        'Fee assignment not found for this student.',
      );
    }
    // Balance check runs against the DISCOUNTED amount — a scholarship
    // student's balance is their final amount, not the structure amount.
    const finalAmount = applyDiscount(
      assignment.amount,
      assignment.discountType,
      assignment.discountValue,
    );
    const alreadyPaid = assignment.payments.reduce((s, p) => s + p.amount, 0);
    const remaining = finalAmount - alreadyPaid;
    if (incomingAmount > remaining + 0.0001 /* epsilon */) {
      throw new BadRequestException(
        `Payment exceeds remaining due (${round(remaining, 2)}) on this fee.`,
      );
    }
  }

  private async assertStudentBalance(
    studentId: string,
    schoolId: string,
    incomingAmount: number,
  ): Promise<void> {
    const [assignments, paidAgg] = await Promise.all([
      this.prisma.feeAssignment.findMany({
        where: { studentId, schoolId },
        select: { amount: true, discountType: true, discountValue: true },
      }),
      this.prisma.payment.aggregate({
        where: { studentId, schoolId },
        _sum: { amount: true },
      }),
    ]);
    const assigned = assignments.reduce(
      (s, a) => s + applyDiscount(a.amount, a.discountType, a.discountValue),
      0,
    );
    const paid = paidAgg._sum.amount ?? 0;
    const remaining = assigned - paid;
    if (incomingAmount > remaining + 0.0001) {
      throw new BadRequestException(
        `Payment exceeds total outstanding due (${round(remaining, 2)}).`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Dues dashboard
  // ---------------------------------------------------------------------

  async getDues(schoolId: string): Promise<DuesRow[]> {
    const [assignments, payments, students] = await Promise.all([
      this.prisma.feeAssignment.findMany({
        where: { schoolId },
        // Sorting by dueDate here is essential — the FIFO credit
        // allocation below relies on it.
        orderBy: { dueDate: 'asc' },
        select: {
          id: true,
          studentId: true,
          amount: true,
          discountType: true,
          discountValue: true,
          dueDate: true,
          payments: { select: { amount: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { schoolId },
        select: {
          studentId: true,
          amount: true,
          feeAssignmentId: true,
        },
      }),
      this.prisma.student.findMany({
        where: { schoolId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          symbolNumber: true,
          section: {
            select: { name: true, class: { select: { name: true } } },
          },
        },
      }),
    ]);

    const today = stripTime(new Date());

    // Group assignments by student (they're already dueDate-sorted).
    const assignmentsByStudent = new Map<
      string,
      typeof assignments
    >();
    for (const a of assignments) {
      const bucket = assignmentsByStudent.get(a.studentId) ?? [];
      bucket.push(a);
      assignmentsByStudent.set(a.studentId, bucket);
    }

    // Aggregate per-student: totalPaid (all payments) and totalCredit
    // (RAW sum of unlinked payments — our single source of truth).
    const unlinkedCreditByStudent = new Map<string, number>();
    const paidByStudent = new Map<string, number>();
    for (const p of payments) {
      paidByStudent.set(
        p.studentId,
        (paidByStudent.get(p.studentId) ?? 0) + p.amount,
      );
      if (p.feeAssignmentId === null) {
        unlinkedCreditByStudent.set(
          p.studentId,
          (unlinkedCreditByStudent.get(p.studentId) ?? 0) + p.amount,
        );
      }
    }

    const rows: DuesRow[] = [];
    for (const s of students) {
      const studentAssignments = assignmentsByStudent.get(s.id) ?? [];
      let base = 0;
      let assigned = 0;
      // FIFO credit is used here only to determine which fees count as
      // OVERDUE. The raw credit balance itself is NOT computed from this
      // walk — that comes from unlinkedCreditByStudent (the single
      // source of truth).
      let notionalPool = unlinkedCreditByStudent.get(s.id) ?? 0;
      let oldestUnpaidDue: Date | null = null;
      let anyOverdue = false;
      for (const a of studentAssignments) {
        const finalAmount = applyDiscount(
          a.amount,
          a.discountType,
          a.discountValue,
        );
        base += a.amount;
        assigned += finalAmount;
        const paidDirect = a.payments.reduce((acc, p) => acc + p.amount, 0);
        let open = Math.max(0, finalAmount - paidDirect);
        if (open > 0 && notionalPool > 0) {
          const take = Math.min(notionalPool, open);
          open -= take;
          notionalPool -= take;
        }
        if (open > 0) {
          if (!oldestUnpaidDue || a.dueDate < oldestUnpaidDue) {
            oldestUnpaidDue = a.dueDate;
          }
          if (stripTime(a.dueDate) < today) anyOverdue = true;
        }
      }

      const paid = paidByStudent.get(s.id) ?? 0;
      const discount = Math.max(0, base - assigned);
      const due = Math.max(0, assigned - paid);
      const credit = unlinkedCreditByStudent.get(s.id) ?? 0; // raw pool

      // Keep students on the dues list when they STILL owe money OR have
      // recorded general credit worth showing. Fully-settled students
      // with no credit activity drop off.
      if (due <= 0 && credit <= 0) continue;

      rows.push({
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        symbolNumber: s.symbolNumber,
        className: s.section?.class.name ?? null,
        sectionName: s.section?.name ?? null,
        totalBase: round(base, 2),
        totalDiscount: round(discount, 2),
        totalAssigned: round(assigned, 2),
        totalPaid: round(paid, 2),
        totalDue: round(due, 2),
        totalCredit: round(credit, 2),
        oldestDueDate: oldestUnpaidDue
          ? oldestUnpaidDue.toISOString().slice(0, 10)
          : null,
        overdue: anyOverdue,
      });
    }

    // Sort: overdue first, then largest due. Pure-credit rows (no
    // outstanding due but non-zero credit) go to the end.
    rows.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if ((a.totalDue > 0) !== (b.totalDue > 0))
        return a.totalDue > 0 ? -1 : 1;
      return b.totalDue - a.totalDue;
    });

    return rows;
  }

  // ---------------------------------------------------------------------
  // Receipts
  // ---------------------------------------------------------------------

  async getReceipt(paymentId: string, schoolId: string): Promise<Receipt> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            symbolNumber: true,
            section: {
              select: { name: true, class: { select: { name: true } } },
            },
          },
        },
        feeAssignment: {
          include: {
            feeStructure: {
              select: { id: true, name: true, frequency: true },
            },
            // All payments on this assignment — used to compute
            // totalPaidOnFee and remainingOnFee for the receipt breakdown.
            payments: { select: { amount: true } },
          },
        },
        school: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (!payment.receiptNumber) {
      throw new NotFoundException(
        'No receipt is available for this payment. Record a new payment to generate one.',
      );
    }

    const section = payment.student.section
      ? {
          name: payment.student.section.name,
          className: payment.student.section.class.name,
        }
      : null;

    const feeStructure = payment.feeAssignment?.feeStructure
      ? {
          id: payment.feeAssignment.feeStructure.id,
          name: payment.feeAssignment.feeStructure.name,
          frequency: payment.feeAssignment.feeStructure.frequency,
        }
      : null;

    // Compute the fee breakdown for linked payments. Unlinked General
    // Credit payments have no single fee to report against — feeDetail
    // stays null and the receipt falls back to its simpler "amount paid"
    // summary.
    let feeDetail: ReceiptFeeDetail | null = null;
    if (payment.feeAssignment) {
      const fa = payment.feeAssignment;
      const baseAmount = fa.amount;
      const finalAmount = applyDiscount(
        baseAmount,
        fa.discountType,
        fa.discountValue,
      );
      const paidDirectOnFee = fa.payments.reduce((s, p) => s + p.amount, 0);

      // To answer "how much of this fee was notionally covered by
      // General Credit?" we have to replay the FIFO allocation across
      // ALL of the student's assignments, because the credit pool is
      // shared. Then the number for this specific fee falls out of the
      // walk.
      const paidFromCreditOnFee = await this.computeCreditAllocationForFee(
        payment.studentId,
        schoolId,
        fa.id,
      );
      const totalPaidOnFee = paidDirectOnFee + paidFromCreditOnFee;
      const remainingOnFee = Math.max(0, finalAmount - totalPaidOnFee);

      feeDetail = {
        baseAmount: round(baseAmount, 2),
        discountType: fa.discountType,
        discountValue: fa.discountValue,
        discountAmount: round(baseAmount - finalAmount, 2),
        finalAmount: round(finalAmount, 2),
        totalPaidOnFee: round(totalPaidOnFee, 2),
        paidDirectOnFee: round(paidDirectOnFee, 2),
        paidFromCreditOnFee: round(paidFromCreditOnFee, 2),
        remainingOnFee: round(remainingOnFee, 2),
      };
    }

    return {
      paymentId: payment.id,
      receiptNumber: payment.receiptNumber,
      date: payment.date.toISOString().slice(0, 10),
      amount: payment.amount,
      method: payment.method,
      notes: payment.notes,
      student: {
        id: payment.student.id,
        firstName: payment.student.firstName,
        lastName: payment.student.lastName,
        symbolNumber: payment.student.symbolNumber,
        section,
      },
      feeStructure,
      feeDetail,
      school: payment.school,
      recordedAt: payment.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------
  // Helpers — FIFO credit replay for a single fee
  // ---------------------------------------------------------------------

  /**
   * Replay the student-wide oldest-first credit allocation and report
   * only the portion that landed on `targetAssignmentId`. Used by
   * `getReceipt` to annotate "Paid directly vs From credit" on a
   * specific fee without recomputing the entire StudentFeesReport.
   *
   * The walk mirrors the one in `getStudentFees` exactly so the two
   * views can't disagree on how credit notionally settled a fee.
   */
  private async computeCreditAllocationForFee(
    studentId: string,
    schoolId: string,
    targetAssignmentId: string,
  ): Promise<number> {
    const [assignments, unlinkedPayments] = await Promise.all([
      this.prisma.feeAssignment.findMany({
        where: { studentId, schoolId },
        orderBy: { dueDate: 'asc' },
        include: { payments: { select: { amount: true } } },
      }),
      this.prisma.payment.aggregate({
        where: { studentId, schoolId, feeAssignmentId: null },
        _sum: { amount: true },
      }),
    ]);

    let pool = unlinkedPayments._sum.amount ?? 0;
    for (const a of assignments) {
      if (pool <= 0) break;
      const finalAmount = applyDiscount(
        a.amount,
        a.discountType,
        a.discountValue,
      );
      const paidDirect = a.payments.reduce((s, p) => s + p.amount, 0);
      const open = Math.max(0, finalAmount - paidDirect);
      if (open <= 0) continue;
      const take = Math.min(pool, open);
      if (a.id === targetAssignmentId) return take;
      pool -= take;
    }
    return 0;
  }

  // ---------------------------------------------------------------------
  // Helpers — tenant guards
  // ---------------------------------------------------------------------

  private async assertClassBelongsToSchool(
    classId: string,
    schoolId: string,
  ): Promise<void> {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, schoolId },
      select: { id: true },
    });
    if (!klass) {
      throw new BadRequestException(
        'Class does not belong to this school.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply a discount (PERCENT or FIXED) to a base amount and clamp at 0.
 *
 *   PERCENT → base − base × value / 100
 *   FIXED   → base − value
 *
 * If either `type` or `value` is null the base is returned unchanged.
 */
function applyDiscount(
  base: number,
  type: DiscountType | null | undefined,
  value: number | null | undefined,
): number {
  if (type == null || value == null) return base;
  let deducted: number;
  if (type === DiscountType.PERCENT) {
    // Clamp the percentage to [0, 100] defensively — the DTO already
    // validates, but don't let a bad row in the DB produce negative dues.
    const pct = Math.max(0, Math.min(100, value));
    deducted = base * (pct / 100);
  } else {
    deducted = value;
  }
  return Math.max(0, base - deducted);
}

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function stripTime(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function round(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}
