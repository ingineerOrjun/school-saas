import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
import BikramSambat from 'bikram-sambat-js';
import { AssignFeeDto } from './dto/assign-fee.dto';
import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { UpdateFeeAssignmentDto } from './dto/update-fee-assignment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

/**
 * Coarse status of a single fee assignment.
 *
 *   PAID     — `remaining === 0`. No further action needed.
 *   PARTIAL  — at least one payment has landed but balance > 0.
 *   DUE_SOON — no payments yet AND due within `DUE_SOON_WINDOW_DAYS`.
 *              The cashier sees an amber chip ("due in N days") so they
 *              can chase the parent before it tips into OVERDUE.
 *   UNPAID   — no payments yet, due-date in the future beyond the
 *              soon-window. Neutral chip — no action urgency.
 *   OVERDUE  — open balance AND due-date is past. Red chip + days-late
 *              counter on the row.
 *
 * `OVERDUE` is BIDIRECTIONAL with `PARTIAL` — a partial payment that's
 * also past-due reads as OVERDUE because the financial urgency wins.
 */
export type AssignmentStatus =
  | 'PAID'
  | 'PARTIAL'
  | 'DUE_SOON'
  | 'UNPAID'
  | 'OVERDUE';

/**
 * Days-until-due window that flips an assignment to DUE_SOON. Schools
 * typically set this to a billing cycle boundary; 7 days is the
 * "this week" window most cashiers naturally chase.
 */
const DUE_SOON_WINDOW_DAYS = 7;

/**
 * Snapshot of school-wide fees state, used to drive the dashboard
 * summary cards. All numbers are denominated in the school's currency
 * (rupees) and rounded to 2dp.
 */
export interface FeesSummary {
  /** Sum of all positive payment amounts ever recorded in this school. */
  totalCollected: number;
  /** Sum of finalAmount across every active assignment. */
  totalAssigned: number;
  /** totalAssigned − totalCollected (clamped at 0). */
  totalPending: number;
  /**
   * Sum of `remaining` across assignments whose due-date is past today.
   * Refunds are folded into the per-student paid totals so this number
   * is faithful even after reversals.
   */
  totalOverdue: number;
  /** Payments dated today (sum of amount, refunds subtracted). */
  todayCollection: number;
  /** Payments dated within this calendar month (sum of amount). */
  thisMonthCollection: number;
  /** Distinct students with `totalDue > 0`. */
  studentsWithDues: number;
  /** Last 12 months, oldest-first. `month` is "YYYY-MM" (AD). */
  monthlyTrend: Array<{ month: string; collected: number }>;
}

/** One row in the global Payment History endpoint. */
export interface PaymentHistoryRow {
  id: string;
  receiptNumber: string | null;
  date: string;
  amount: number;
  method: PaymentMethod | null;
  notes: string | null;
  status: 'ACTIVE' | 'REFUNDED' | 'VOID';
  isRefund: boolean;
  /** Linked fee, if any. Null for general-credit payments. */
  feeStructureName: string | null;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    symbolNumber: string | null;
    className: string | null;
    sectionName: string | null;
  };
  cashier: { id: string; email: string; role: string } | null;
  createdAt: string;
}

export interface PaymentHistoryQuery {
  /** Free-text — matches student name, symbol no, or receipt no. */
  q?: string;
  /** ISO date YYYY-MM-DD inclusive. */
  fromDate?: string;
  toDate?: string;
  method?: PaymentMethod;
  classId?: string;
  studentId?: string;
  /** 1-indexed page number. Defaults to 1. */
  page?: number;
  /** Defaults to 25, capped at 100. */
  pageSize?: number;
}

export interface PaymentHistoryResponse {
  rows: PaymentHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Today's-collection panel for the cashier workspace. Splits the day's
 * activity by method and (optionally) by cashier so the operator can
 * answer at a glance "what's the cash drawer telling me?"
 *
 * `byMethod` totals are NET of refunds — a Rs. 5,000 cash payment
 * followed by a Rs. 2,000 cash refund nets to Rs. 3,000 in CASH.
 * That mirrors what the physical drawer shows.
 *
 * `byCashier` is keyed by user id; an entry with id `null` covers
 * legacy rows that pre-date the audit-fields migration. Always rendered
 * sorted by collected-desc so the busiest cashier surfaces first.
 */
export interface CashierSummary {
  /** YYYY-MM-DD of the day this snapshot covers (defaults to today). */
  date: string;
  /** Sum of payment.amount for the day (refunds subtract). */
  collectedToday: number;
  /** Count of ACTIVE payment rows dated today (refunds excluded). */
  transactionsToday: number;
  /** Count of refund rows recorded today (negative-amount payments). */
  refundsToday: number;
  /** Total refunded amount today (positive — sum of |amount|). */
  refundsAmountToday: number;
  /** Net collection grouped by payment method. */
  byMethod: {
    method: PaymentMethod | 'UNKNOWN';
    amount: number;
    count: number;
  }[];
  /** Per-cashier breakdown — useful for end-of-day reconciliation. */
  byCashier: {
    userId: string | null;
    email: string | null;
    role: string | null;
    amount: number;
    count: number;
  }[];
}

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
   * Days the assignment is past its due-date (positive) or until its
   * due-date (negative). Computed against today (UTC midnight). Always
   * 0 when the assignment is fully paid (no urgency once cleared).
   *
   *   +5 → 5 days OVERDUE
   *    0 → due today / paid in full
   *   −3 → due in 3 days (drives the DUE_SOON chip)
   */
  daysOverdue: number;
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

/**
 * One row in the multi-line fee table on the receipt. Every assignment
 * the student has at the moment of payment shows up — so a receipt for
 * "Tuition · June" still gives the parent a snapshot of where Lab and
 * Bus dues stand. Each row is annotated with how much of THIS payment
 * landed on it (the focal row gets `paidThisReceipt > 0`; siblings stay
 * at 0).
 */
export interface ReceiptLineItem {
  feeAssignmentId: string;
  feeName: string;
  baseAmount: number;
  discountAmount: number;
  finalAmount: number;
  /** Total paid on this fee through the moment of this payment. */
  paidToDate: number;
  /** Portion of THIS payment that landed on this line. */
  paidThisReceipt: number;
  remaining: number;
  status: AssignmentStatus;
  /** True if the line is the one explicitly linked to this payment. */
  isFocal: boolean;
}

export type ReceiptStatus = 'PAID_IN_FULL' | 'PARTIAL' | 'BALANCE_DUE';

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
  school: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    /** Optional postal address — null when admin hasn't filled it in. */
    address: string | null;
    /** Optional public phone — null when admin hasn't filled it in. */
    phone: string | null;
  };
  /**
   * Every fee on the student's account at the moment of payment, with
   * paid/remaining annotations. Empty array for students with no
   * assignments (rare — e.g. a one-off general credit deposit).
   */
  lineItems: ReceiptLineItem[];
  /**
   * Snapshot of the student's overall ledger AT THE MOMENT THIS PAYMENT
   * WAS RECORDED. Lets the receipt show "Previous Due / Paid Now /
   * Remaining Balance" without needing a second round-trip — and stays
   * faithful even if more payments land later.
   */
  ledger: {
    /** Outstanding due BEFORE this payment was applied. */
    previousDue: number;
    /** Amount paid on THIS receipt. Mirror of `amount` for clarity. */
    paidNow: number;
    /** Outstanding due AFTER this payment was applied (≥ 0). */
    remainingBalance: number;
    /** Unallocated General Credit balance after this payment. */
    creditBalance: number;
  };
  /**
   * Coarse-grained status for the badge rendered in the header:
   *   PAID_IN_FULL → no balance after this payment.
   *   PARTIAL      → balance still owing, but at least one fee fully cleared.
   *   BALANCE_DUE  → balance still owing.
   * Computed from the ledger snapshot, not "as of now."
   */
  status: ReceiptStatus;
  /**
   * True when this payment is itself a refund (negative amount). Pure
   * display flag — refunds are stored as negative `Payment` rows so they
   * cascade through the same balance arithmetic as regular payments.
   */
  isRefund: boolean;
  /**
   * Stable URL the QR code links to, for paper-trail verification. Set
   * to null when no public verification host is configured.
   */
  verificationUrl: string | null;
  /**
   * The cashier (User row) who originally recorded this payment.
   * Surfaces on the receipt's "Received by" line. Null for legacy
   * rows that pre-date the audit-fields migration.
   */
  cashier: { id: string; email: string; role: string } | null;
  recordedAt: string;
}

@Injectable()
export class FeesService {
  private readonly logger = new Logger(FeesService.name);

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
        const { status, overdue, daysOverdue } = deriveAssignmentStatus({
          remaining,
          paid,
          dueDate: a.dueDate,
          today,
        });
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
          daysOverdue,
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
    /**
     * The cashier (User row) recording this payment. Stamped onto the
     * row as `createdById` so the receipt and audit trail can answer
     * "who took this in?" Optional only because some legacy callers
     * (background jobs / migrations) don't have a user context.
     */
    actingUserId?: string,
  ): Promise<Payment> {
    // Single entry-point log. The body has no PII — student is a UUID,
    // amount/date/method are non-sensitive — so we can log it in full.
    // Useful when reproducing a "payment failed" report from a real user.
    this.logger.log(
      `recordPayment student=${dto.studentId} amount=${dto.amount} ` +
        `feeAssignmentId=${dto.feeAssignmentId ?? '<none>'} ` +
        `method=${dto.method ?? '<none>'} ` +
        `idempotencyKey=${dto.clientRequestId ?? '<none>'} ` +
        `cashier=${actingUserId ?? '<none>'} schoolId=${schoolId}`,
    );

    try {
      return await this.recordPaymentInner(dto, schoolId, actingUserId);
    } catch (e) {
      // 4xx exceptions (validation, FK failures we caught) are expected
      // and shouldn't fill the logs with stack traces — let the global
      // filter handle them. Unknown errors get logged here with full
      // context so the operator can debug from server logs alone.
      if (this.isKnownHttpException(e)) throw e;
      this.logger.error(
        `recordPayment failed for student=${dto.studentId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        e instanceof Error ? e.stack : undefined,
      );
      throw e;
    }
  }

  /**
   * Inner implementation — split out so the public method can wrap with
   * structured logging without nested try/catch noise.
   *
   * Order of operations matters:
   *   1. Idempotency short-circuit (cheapest, runs before any validation
   *      that could spuriously fail on the second submit of a successful
   *      payment).
   *   2. Student existence (FK guarantee).
   *   3. Assignment existence + ownership (FK guarantee, prevents the
   *      "create payment for fee belonging to another student" attack).
   *   4. Balance check (business rule).
   *   5. Receipt-number generation + create with retry on race.
   */
  private async recordPaymentInner(
    dto: CreatePaymentDto,
    schoolId: string,
    actingUserId?: string,
  ): Promise<Payment> {
    // ------------------------------------------------------------------
    // 1. Idempotency short-circuit.
    // ------------------------------------------------------------------
    if (dto.clientRequestId) {
      const existing = await this.prisma.payment.findFirst({
        where: { schoolId, clientRequestId: dto.clientRequestId },
      });
      if (existing) {
        this.logger.log(
          `idempotent replay → returning existing payment id=${existing.id}`,
        );
        return existing;
      }
    }

    // ------------------------------------------------------------------
    // 2. Student must exist within this school.
    // ------------------------------------------------------------------
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }

    // ------------------------------------------------------------------
    // 3. Assignment validation (only when linked).
    //
    // Must satisfy ALL of:
    //   • The assignment exists.
    //   • It belongs to the same school (multi-tenant safety).
    //   • It belongs to the student we're paying for.
    // The combined `findFirst` gives us all three in one round-trip;
    // missing-OR-mismatched both surface as "not found for this student"
    // — the caller doesn't need to distinguish "wrong school" from
    // "doesn't exist."
    // ------------------------------------------------------------------
    if (dto.feeAssignmentId) {
      const assignment = await this.prisma.feeAssignment.findFirst({
        where: {
          id: dto.feeAssignmentId,
          schoolId,
          studentId: dto.studentId,
        },
        select: { id: true },
      });
      if (!assignment) {
        throw new BadRequestException(
          'Fee assignment not found for this student.',
        );
      }

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

    // ------------------------------------------------------------------
    // 4. Receipt-number generation + safe create with retry.
    // ------------------------------------------------------------------
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const receiptNumber = await this.nextReceiptNumber(
        schoolId,
        dto.date,
        attempt,
      );
      try {
        const created = await this.prisma.payment.create({
          data: {
            studentId: dto.studentId,
            amount: round(dto.amount, 2),
            date: parseDate(dto.date),
            feeAssignmentId: dto.feeAssignmentId ?? null,
            schoolId,
            receiptNumber,
            notes: dto.notes ?? null,
            method: dto.method ?? null,
            clientRequestId: dto.clientRequestId ?? null,
            createdById: actingUserId ?? null,
            updatedById: actingUserId ?? null,
          },
        });
        this.logger.log(
          `recorded payment id=${created.id} receipt=${created.receiptNumber}`,
        );
        return created;
      } catch (e) {
        lastError = e;
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          // P2002 has two flavours here. Distinguish by the meta target:
          //
          //   • clientRequestId collision → another concurrent call
          //     committed first under the same idempotency key. The
          //     race-winner is the source of truth — return it. This
          //     keeps idempotency strict (not "best-effort").
          //
          //   • receiptNumber collision → bump the counter, retry.
          //
          // Anything else with P2002 is unexpected and should propagate.
          const target = (e.meta as { target?: string[] | string })?.target;
          const targetList = Array.isArray(target)
            ? target
            : typeof target === 'string'
              ? [target]
              : [];

          if (
            dto.clientRequestId &&
            targetList.some((t) => t.includes('clientRequestId'))
          ) {
            const existing = await this.prisma.payment.findFirst({
              where: { schoolId, clientRequestId: dto.clientRequestId },
            });
            if (existing) {
              this.logger.log(
                `idempotency race resolved → returning existing payment id=${existing.id}`,
              );
              return existing;
            }
          }

          if (
            targetList.some((t) => t.includes('receiptNumber')) &&
            attempt < MAX_ATTEMPTS - 1
          ) {
            this.logger.warn(
              `receipt-number collision (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying`,
            );
            continue;
          }
        }
        throw e;
      }
    }
    // Exhausted retries on the receipt-number race. Surface as a 409
    // — the operator can hit "Save & Print" again and idempotency
    // will deduplicate the retry.
    this.logger.error(
      `recordPayment exhausted ${MAX_ATTEMPTS} attempts for student=${dto.studentId}`,
      lastError instanceof Error ? lastError.stack : undefined,
    );
    throw new ConflictException(
      'Could not generate a unique receipt number after multiple attempts. Please try again.',
    );
  }

  /** True for NestJS HTTP exceptions — those are intentional, don't log as errors. */
  private isKnownHttpException(e: unknown): boolean {
    return (
      e instanceof BadRequestException ||
      e instanceof NotFoundException ||
      e instanceof ConflictException
    );
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
    actingUserId?: string,
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
        // updatedById flips even when only annotations changed — that's
        // the audit signal "this payment was last touched by …", not
        // "the financial data changed."
        ...(actingUserId ? { updatedById: actingUserId } : {}),
      },
    });
  }

  /**
   * Refund a previously-recorded payment.
   *
   * Append-only: we never delete or zero out the source row. Instead,
   * we create a NEW payment row with a NEGATIVE amount, linked back to
   * the original via `refundOfPaymentId`. The receipt number for the
   * refund slip carries an `R-` suffix (RCPT-2026-0042 → RCPT-2026-0042R)
   * so the audit trail reads cleanly: "this is a reversal of that."
   *
   * Constraints:
   *   • Refund amount can't exceed the source payment.
   *   • A source can only be refunded once (DB-enforced via the unique
   *     index on `refundOfPaymentId`).
   *   • Refunding a refund is rejected — reversals are themselves frozen.
   *   • Same fee link as the source — keeps the math symmetric: a
   *     payment that landed on Tuition refunds back off Tuition.
   */
  async refundPayment(
    paymentId: string,
    dto: RefundPaymentDto,
    schoolId: string,
    actingUserId?: string,
  ): Promise<Payment> {
    const source = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId },
      select: {
        id: true,
        amount: true,
        studentId: true,
        feeAssignmentId: true,
        receiptNumber: true,
        refundOfPaymentId: true,
        refundedBy: { select: { id: true } },
      },
    });
    if (!source) throw new NotFoundException('Payment not found.');

    if (source.refundOfPaymentId !== null) {
      throw new BadRequestException(
        'Cannot refund a refund. Issue a fresh payment if needed.',
      );
    }
    if (source.refundedBy) {
      throw new ConflictException(
        'This payment has already been refunded.',
      );
    }
    if (source.amount <= 0) {
      throw new BadRequestException(
        'Source payment has no positive amount to refund.',
      );
    }
    if (dto.amount > source.amount + 0.0001) {
      throw new BadRequestException(
        `Refund amount cannot exceed the original payment (${round(source.amount, 2)}).`,
      );
    }

    // Refund receipt number: source's number with an `R` suffix.
    // Falls back to a fresh generation if the source pre-dates the
    // receipt-number system (legacy rows with `receiptNumber: null`).
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const refundReceiptNumber =
      source.receiptNumber !== null
        ? `${source.receiptNumber}R`
        : await this.nextReceiptNumber(schoolId, todayIso);

    // Atomic two-row write: append the refund row AND flip the source
    // status to REFUNDED. We never mutate the source's amount/receipt #
    // — only the lifecycle flag — so the original receipt stays valid
    // forever. Wrapping both writes in a transaction guarantees the
    // status flip can't drift from the refund row's existence.
    const [refundRow] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          studentId: source.studentId,
          amount: -Math.abs(round(dto.amount, 2)),
          date: today,
          feeAssignmentId: source.feeAssignmentId,
          schoolId,
          receiptNumber: refundReceiptNumber,
          notes: dto.notes ?? null,
          method: null,
          refundOfPaymentId: source.id,
          refundReason: dto.reason,
          // The refund slip itself is ACTIVE — it's a real payment row.
          // Only the source flips to REFUNDED.
          status: 'ACTIVE',
          createdById: actingUserId ?? null,
          updatedById: actingUserId ?? null,
        },
      }),
      this.prisma.payment.update({
        where: { id: source.id },
        data: {
          status: 'REFUNDED',
          ...(actingUserId ? { updatedById: actingUserId } : {}),
        },
      }),
    ]);
    return refundRow;
  }

  /**
   * Generate the next receipt number for a given school + payment date.
   *
   * Format: `FR-{BS_YEAR}-{NNNNNN}`
   *   • `FR` — Fee Receipt prefix.
   *   • BS_YEAR — Bikram-Sambat year of the payment date. The rest of
   *     the app shows dual-calendar dates and the BS year is the one a
   *     Nepali parent recognises on the slip; aligning the receipt
   *     series to it keeps the artifact internally consistent (e.g.
   *     "FR-2083-…" and the Date row above it both read 2083).
   *   • NNNNNN — zero-padded 6-digit running counter, scoped to the
   *     school + BS year. Six digits is enough for a million receipts a
   *     year — comfortable headroom for the busiest schools.
   *
   * Sequence is per-school + per-BS-year. Roll-over to a new BS year
   * resets the counter to 000001, which matches how schools file their
   * paper books.
   *
   * Race safety: callers retry up to MAX_ATTEMPTS with `bump`; we add
   * the bump to the candidate number so concurrent inserts don't both
   * land on the same value. The DB unique constraint is the final word
   * — bump just helps us probe past the collision quickly.
   */
  private async nextReceiptNumber(
    schoolId: string,
    paymentDateIso: string, // YYYY-MM-DD (AD)
    bump = 0,
  ): Promise<string> {
    const bsYear = adIsoToBsYear(paymentDateIso);
    const prefix = `FR-${bsYear}-`;

    // Find the max existing for THIS prefix. lexicographic-desc works
    // because the suffix is fixed-width zero-padded.
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
    return `${prefix}${String(next + bump).padStart(6, '0')}`;
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
  // Dashboard summary
  // ---------------------------------------------------------------------

  /**
   * Compose the dashboard summary cards: totals, today, this month,
   * overdue, monthly trend.
   *
   * Implementation notes:
   *   • Today / this-month boundaries are computed in UTC. The
   *     school's wall-clock can drift slightly across midnight, but
   *     the operational impact is minimal — the cashier seeing
   *     "yesterday's last payment in today's bucket" 5 minutes after
   *     midnight is a harmless edge.
   *   • Overdue is recomputed from `getDues()` so it stays consistent
   *     with the dues page — single source of truth, no parallel
   *     numbers diverging.
   *   • Monthly trend uses native JS date math; for 12 buckets it's
   *     fine to just do an in-memory bucket-by-month after pulling
   *     payments-from-the-last-year. Avoids a per-bucket roundtrip.
   */
  async getSummary(schoolId: string): Promise<FeesSummary> {
    const today = stripTime(new Date());
    const startOfMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const startOfYearAgo = new Date(today);
    startOfYearAgo.setUTCMonth(startOfYearAgo.getUTCMonth() - 11);
    startOfYearAgo.setUTCDate(1);

    const [assignments, paymentsAll, dues] = await Promise.all([
      this.prisma.feeAssignment.findMany({
        where: { schoolId },
        select: { amount: true, discountType: true, discountValue: true },
      }),
      // Pull payments back to the start of "12 months ago" — the
      // narrowest range that covers both the trend chart and the
      // today/month buckets without re-querying.
      this.prisma.payment.findMany({
        where: { schoolId, date: { gte: startOfYearAgo } },
        select: { amount: true, date: true },
      }),
      this.getDues(schoolId),
    ]);

    const totalAssigned = assignments.reduce(
      (s, a) => s + applyDiscount(a.amount, a.discountType, a.discountValue),
      0,
    );

    // totalCollected is "all time"; fetch as an aggregate so we don't
    // pull every payment row into memory just for one number.
    const allTimePaid = await this.prisma.payment.aggregate({
      where: { schoolId },
      _sum: { amount: true },
    });
    const totalCollected = allTimePaid._sum.amount ?? 0;
    const totalPending = Math.max(0, totalAssigned - totalCollected);

    const totalOverdue = dues.reduce(
      (s, d) => s + (d.overdue ? d.totalDue : 0),
      0,
    );

    let todayCollection = 0;
    let thisMonthCollection = 0;
    const monthBuckets = new Map<string, number>();
    for (const p of paymentsAll) {
      const d = stripTime(p.date);
      if (d.getTime() === today.getTime()) todayCollection += p.amount;
      if (d >= startOfMonth) thisMonthCollection += p.amount;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + p.amount);
    }

    // Build the 12-month trend, oldest-first. Months with zero
    // payments still show up as `collected: 0` so the chart line
    // stays continuous instead of having gaps.
    const monthlyTrend: Array<{ month: string; collected: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(today);
      dt.setUTCMonth(dt.getUTCMonth() - i);
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      monthlyTrend.push({
        month: key,
        collected: round(monthBuckets.get(key) ?? 0, 2),
      });
    }

    return {
      totalCollected: round(totalCollected, 2),
      totalAssigned: round(totalAssigned, 2),
      totalPending: round(totalPending, 2),
      totalOverdue: round(totalOverdue, 2),
      todayCollection: round(todayCollection, 2),
      thisMonthCollection: round(thisMonthCollection, 2),
      studentsWithDues: dues.filter((d) => d.totalDue > 0).length,
      monthlyTrend,
    };
  }

  // ---------------------------------------------------------------------
  // Payment history
  // ---------------------------------------------------------------------

  /**
   * Paginated, filterable list of payments for the global Payment
   * History page. Returns `total` so the UI can render proper
   * pagination, and `rows` enriched with the cashier + student
   * context the table needs (one round-trip, no N+1).
   *
   * Filter behaviour:
   *   • `q` matches student first/last name, symbol number, or
   *     receipt number — case-insensitive contains.
   *   • `fromDate` / `toDate` are date-inclusive boundaries on the
   *     payment's `date` (NOT createdAt — backdated payments should
   *     surface in their backdated bucket).
   *   • `classId` filters by the student's CURRENT class. Students
   *     who paid then moved class still show up under their current
   *     class — that's the operationally useful view; if you need
   *     "who was in class X when they paid" we'd have to snapshot
   *     class on the Payment row, which we don't.
   */
  async listPayments(
    schoolId: string,
    query: PaymentHistoryQuery,
  ): Promise<PaymentHistoryResponse> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    // Build the WHERE clause incrementally — each filter is optional
    // and combines as an AND.
    const where: Prisma.PaymentWhereInput = { schoolId };
    if (query.fromDate || query.toDate) {
      where.date = {};
      if (query.fromDate) where.date.gte = parseDate(query.fromDate);
      if (query.toDate) where.date.lte = parseDate(query.toDate);
    }
    if (query.method) where.method = query.method;
    if (query.studentId) where.studentId = query.studentId;
    if (query.classId) {
      // Filter via the student's current class. `is` traverses the
      // student relation; combined with schoolId it stays tenant-safe.
      where.student = { is: { classId: query.classId } };
    }
    if (query.q) {
      const q = query.q.trim();
      if (q.length > 0) {
        where.OR = [
          { receiptNumber: { contains: q, mode: 'insensitive' } },
          {
            student: {
              is: {
                OR: [
                  { firstName: { contains: q, mode: 'insensitive' } },
                  { lastName: { contains: q, mode: 'insensitive' } },
                  { symbolNumber: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          },
        ];
      }
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        // Newest first — cashiers expect "what just came in" at the top.
        // Tiebreak on createdAt so backdated rows still order
        // deterministically among same-date entries.
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
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
              class: { select: { name: true } },
            },
          },
          feeAssignment: {
            select: { feeStructure: { select: { name: true } } },
          },
          createdBy: { select: { id: true, email: true, role: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      rows: rows.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        date: p.date.toISOString().slice(0, 10),
        amount: round(p.amount, 2),
        method: p.method,
        notes: p.notes,
        status: p.status,
        isRefund: p.amount < 0,
        feeStructureName: p.feeAssignment?.feeStructure?.name ?? null,
        student: {
          id: p.student.id,
          firstName: p.student.firstName,
          lastName: p.student.lastName,
          symbolNumber: p.student.symbolNumber,
          className:
            p.student.section?.class.name ?? p.student.class?.name ?? null,
          sectionName: p.student.section?.name ?? null,
        },
        cashier: p.createdBy
          ? {
              id: p.createdBy.id,
              email: p.createdBy.email,
              role: p.createdBy.role,
            }
          : null,
        createdAt: p.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  // ---------------------------------------------------------------------
  // Cashier workspace — today's collection summary
  // ---------------------------------------------------------------------

  /**
   * Snapshot of payment activity for a given day. Powers the today's-
   * stats bar at the top of `/fees/collect`. Single round-trip:
   * everything derives from one `findMany` over the day's payments.
   *
   * `dateIso` defaults to today (UTC). The cashier shouldn't normally
   * pass a date, but we accept it for "show me yesterday's reconciliation"
   * follow-ups without needing a separate endpoint.
   */
  async getCashierSummary(
    schoolId: string,
    dateIso?: string,
  ): Promise<CashierSummary> {
    const target = dateIso ? parseDate(dateIso) : stripTime(new Date());
    const targetDate = stripTime(target);
    const nextDay = new Date(targetDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const payments = await this.prisma.payment.findMany({
      where: {
        schoolId,
        date: { gte: targetDate, lt: nextDay },
      },
      select: {
        amount: true,
        method: true,
        createdById: true,
        createdBy: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    let collectedToday = 0;
    let transactionsToday = 0;
    let refundsToday = 0;
    let refundsAmountToday = 0;
    const methodTotals = new Map<
      PaymentMethod | 'UNKNOWN',
      { amount: number; count: number }
    >();
    const cashierTotals = new Map<
      string,
      {
        userId: string | null;
        email: string | null;
        role: string | null;
        amount: number;
        count: number;
      }
    >();

    for (const p of payments) {
      collectedToday += p.amount;
      if (p.amount < 0) {
        refundsToday += 1;
        refundsAmountToday += -p.amount;
      } else {
        transactionsToday += 1;
      }

      const methodKey: PaymentMethod | 'UNKNOWN' = p.method ?? 'UNKNOWN';
      const m = methodTotals.get(methodKey) ?? { amount: 0, count: 0 };
      m.amount += p.amount;
      m.count += 1;
      methodTotals.set(methodKey, m);

      // Cashier bucketing — null id is the legacy bucket.
      const cashierKey = p.createdById ?? '__unknown__';
      const c = cashierTotals.get(cashierKey) ?? {
        userId: p.createdBy?.id ?? null,
        email: p.createdBy?.email ?? null,
        role: p.createdBy?.role ?? null,
        amount: 0,
        count: 0,
      };
      c.amount += p.amount;
      c.count += 1;
      cashierTotals.set(cashierKey, c);
    }

    return {
      date: targetDate.toISOString().slice(0, 10),
      collectedToday: round(collectedToday, 2),
      transactionsToday,
      refundsToday,
      refundsAmountToday: round(refundsAmountToday, 2),
      byMethod: [...methodTotals.entries()]
        .map(([method, v]) => ({
          method,
          amount: round(v.amount, 2),
          count: v.count,
        }))
        // Highest-amount methods first so the visual hierarchy follows
        // the operational reality (cash usually leads in Nepal schools).
        .sort((a, b) => b.amount - a.amount),
      byCashier: [...cashierTotals.values()]
        .map((c) => ({ ...c, amount: round(c.amount, 2) }))
        .sort((a, b) => b.amount - a.amount),
    };
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
        school: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            address: true,
            phone: true,
          },
        },
        // Audit: cashier who originally recorded this payment. We don't
        // need updatedBy on the receipt — only the original capture
        // matters for "who took this in?"
        createdBy: {
          select: { id: true, email: true, role: true },
        },
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

    // ------------------------------------------------------------------
    // Ledger snapshot + multi-line context at the moment of this payment.
    // ------------------------------------------------------------------
    // The receipt's "Previous Due / Paid Now / Remaining Balance" panel
    // needs three numbers that are *consistent with each other*:
    //   previousDue + paidNow = paidNow + remainingBalance + (delta)
    //
    // We can't just reuse `getStudentFees` (which is "as of now") because
    // re-printing an old receipt months later would surface today's
    // balance, not the one at issue time. So we recompute against the
    // student's full ledger but EXCLUDING any payments newer than this
    // one (by `createdAt`, which preserves issue order even for backdated
    // `date`s).
    //
    // The same query also feeds `lineItems` — every fee on the student's
    // account at issue time, with paid-to-date and remaining annotated.
    // ------------------------------------------------------------------
    const allAssignments = await this.prisma.feeAssignment.findMany({
      where: { studentId: payment.studentId, schoolId },
      orderBy: { dueDate: 'asc' },
      include: {
        feeStructure: { select: { name: true } },
        // Only payments at-or-before this receipt count — re-printing an
        // old receipt should reflect the world as it was when issued.
        payments: {
          where: { createdAt: { lte: payment.createdAt } },
          select: { id: true, amount: true },
        },
      },
    });
    const totalAssigned = allAssignments.reduce(
      (s, a) => s + applyDiscount(a.amount, a.discountType, a.discountValue),
      0,
    );

    // Payments at or before this one (inclusive) — defines "now (after
    // this payment)". Strict-before defines "previous (before this payment)".
    const allPaymentsThroughHere = await this.prisma.payment.findMany({
      where: {
        studentId: payment.studentId,
        schoolId,
        createdAt: { lte: payment.createdAt },
      },
      select: { id: true, amount: true, feeAssignmentId: true },
    });
    const paidThroughHere = allPaymentsThroughHere.reduce(
      (s, p) => s + p.amount,
      0,
    );
    const paidBeforeHere = paidThroughHere - payment.amount;

    const previousDue = Math.max(0, totalAssigned - paidBeforeHere);
    const remainingBalance = Math.max(0, totalAssigned - paidThroughHere);
    const creditBalance = allPaymentsThroughHere
      .filter((p) => p.feeAssignmentId === null)
      .reduce((s, p) => s + p.amount, 0);

    // Build the per-line view. The "focal" line (the assignment this
    // payment was directly linked to, if any) gets paidThisReceipt =
    // payment.amount; others get 0. Unlinked credits have no focal line.
    const lineItems: ReceiptLineItem[] = allAssignments.map((a) => {
      const finalAmount = applyDiscount(a.amount, a.discountType, a.discountValue);
      const paidToDate = a.payments.reduce((s, p) => s + p.amount, 0);
      const remaining = Math.max(0, finalAmount - paidToDate);
      const isFocal = a.id === payment.feeAssignmentId;
      const paidThisReceipt = isFocal ? payment.amount : 0;
      const status: AssignmentStatus =
        remaining === 0 ? 'PAID' : paidToDate > 0 ? 'PARTIAL' : 'UNPAID';
      return {
        feeAssignmentId: a.id,
        feeName: a.feeStructure.name,
        baseAmount: round(a.amount, 2),
        discountAmount: round(a.amount - finalAmount, 2),
        finalAmount: round(finalAmount, 2),
        paidToDate: round(paidToDate, 2),
        paidThisReceipt: round(paidThisReceipt, 2),
        remaining: round(remaining, 2),
        status,
        isFocal,
      };
    });

    // Status badge derivation. We treat "PAID_IN_FULL" strictly — every
    // assignment cleared, no general-credit overhang. Anything in between
    // is PARTIAL/BALANCE_DUE depending on whether at least one fee is
    // fully cleared.
    const anyCleared = lineItems.some((li) => li.status === 'PAID');
    const status: ReceiptStatus =
      remainingBalance === 0
        ? 'PAID_IN_FULL'
        : anyCleared
          ? 'PARTIAL'
          : 'BALANCE_DUE';

    // Verification URL — public host configurable via env. Falls back
    // to null when not configured so the QR is suppressed entirely
    // rather than printing a broken localhost link.
    const publicHost =
      process.env.PUBLIC_RECEIPT_HOST ?? process.env.PUBLIC_APP_URL ?? null;
    const verificationUrl = publicHost
      ? `${publicHost.replace(/\/+$/, '')}/receipts/${payment.id}`
      : null;

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
      lineItems,
      ledger: {
        previousDue: round(previousDue, 2),
        paidNow: round(payment.amount, 2),
        remainingBalance: round(remainingBalance, 2),
        creditBalance: round(creditBalance, 2),
      },
      status,
      isRefund: payment.amount < 0,
      verificationUrl,
      cashier: payment.createdBy
        ? {
            id: payment.createdBy.id,
            email: payment.createdBy.email,
            role: payment.createdBy.role,
          }
        : null,
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

/**
 * Single source of truth for assignment status derivation. Both the
 * per-student report and the per-line receipt context use this — keeps
 * the chip on the fee row and the chip on the receipt line in lock-step.
 *
 * Day math runs at UTC midnight to dodge timezone drift; payments
 * recorded "yesterday" in the school's wall-clock should still count
 * yesterday in this calculation, regardless of the server's TZ.
 */
function deriveAssignmentStatus(input: {
  remaining: number;
  paid: number;
  dueDate: Date;
  today: Date; // already stripTime'd
}): { status: AssignmentStatus; overdue: boolean; daysOverdue: number } {
  const { remaining, paid, dueDate, today } = input;
  const dueMidnight = stripTime(dueDate);
  const dayMs = 24 * 60 * 60 * 1000;
  const daysOverdue = Math.round(
    (today.getTime() - dueMidnight.getTime()) / dayMs,
  );
  // PAID has no urgency — daysOverdue forced to 0 so the UI doesn't
  // surface a stale "5 days late" badge on a cleared fee.
  if (remaining === 0) {
    return { status: 'PAID', overdue: false, daysOverdue: 0 };
  }
  const overdue = daysOverdue > 0;
  if (overdue) {
    // Past-due wins over PARTIAL — the financial urgency is the
    // dominant signal even if some money has landed.
    return { status: 'OVERDUE', overdue: true, daysOverdue };
  }
  if (paid > 0) {
    return { status: 'PARTIAL', overdue: false, daysOverdue };
  }
  // Not past-due, no payments yet. Soon vs. just-unpaid is a UI hint
  // — DUE_SOON triggers an amber "due in N days" chip.
  if (-daysOverdue <= DUE_SOON_WINDOW_DAYS) {
    return { status: 'DUE_SOON', overdue: false, daysOverdue };
  }
  return { status: 'UNPAID', overdue: false, daysOverdue };
}

/**
 * Convert an AD `YYYY-MM-DD` string to the corresponding Bikram-Sambat
 * year (a 4-digit number, e.g. `2083`).
 *
 * Used by the receipt-number generator to align the series with the
 * dual-calendar UI: a slip dated 2083-01-23 BS gets a receipt number
 * `FR-2083-…`. The function returns just the year — the rest of the
 * BS conversion happens at render time on the frontend.
 *
 * Falls back to a sentinel when the date is unparseable: we'd rather
 * accept a slightly weird receipt number than reject the payment.
 */
function adIsoToBsYear(adIso: string): number {
  try {
    const bs = new BikramSambat(adIso, 'AD').toBS();
    // toBS returns "YYYY-MM-DD" in BS — the year is the first 4 chars.
    const year = parseInt(bs.slice(0, 4), 10);
    if (!Number.isNaN(year) && year > 1900 && year < 2200) {
      return year;
    }
  } catch {
    /* fall through to fallback */
  }
  // Conservative fallback: AD year + 56 (the typical BS−AD offset).
  // Misses by 1 across the new-year boundary but still produces a
  // unique-per-year prefix, which is what the sequence relies on.
  const adYear = parseInt(adIso.slice(0, 4), 10);
  return Number.isNaN(adYear) ? 2000 : adYear + 56;
}
