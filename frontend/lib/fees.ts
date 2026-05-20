import { useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { useAuthReady } from "@/hooks/useAuthReady";
import { qk } from "./query-keys";

export type FeeFrequency = "MONTHLY" | "ONE_TIME";
/**
 * Status chip for a single fee assignment. Five values:
 *   PAID     — fully cleared, no urgency
 *   PARTIAL  — some money in, balance remains, not yet past due
 *   DUE_SOON — no money yet, due-date within 7 days (amber chip)
 *   UNPAID   — no money yet, due-date in the future beyond the soon-window
 *   OVERDUE  — open balance AND past due-date (wins over PARTIAL)
 */
export type AssignmentStatus =
  | "PAID"
  | "PARTIAL"
  | "DUE_SOON"
  | "UNPAID"
  | "OVERDUE";
export type PaymentMethod = "CASH" | "BANK" | "ESEWA" | "OTHER";
export type DiscountType = "PERCENT" | "FIXED";

export interface FeeStructureDto {
  id: string;
  name: string;
  amount: number;
  frequency: FeeFrequency;
  /** Null for school-wide fees; populated for class-scoped fees. */
  classId: string | null;
  class: { id: string; name: string } | null;
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentAssignment {
  id: string;
  feeStructureId: string;
  feeStructureName: string;
  /** Pre-discount amount from the fee structure at assignment time. */
  baseAmount: number;
  /** Back-compat — equals `finalAmount`. */
  amount: number;
  /** Post-discount amount the student actually owes. */
  finalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  /** baseAmount − finalAmount (always ≥ 0). */
  discountAmount: number;
  dueDate: string; // YYYY-MM-DD
  /** Payments DIRECTLY linked to this assignment. */
  paidDirect: number;
  /** Share of unlinked General Credit auto-applied by FIFO settlement. */
  paidFromCredit: number;
  /** paidDirect + paidFromCredit. */
  paid: number;
  remaining: number;
  status: AssignmentStatus;
  overdue: boolean;
  /**
   * Days the assignment is past due (positive) or until due (negative).
   * Always 0 once the assignment is fully paid.
   */
  daysOverdue: number;
  /** Backend flag — payments exist on this assignment, discount is frozen. */
  canEditDiscount?: boolean;
}

export interface StudentPayment {
  id: string;
  amount: number;
  date: string;
  feeAssignmentId: string | null;
  receiptNumber: string | null;
  method: PaymentMethod | null;
  notes: string | null;
}

export interface StudentFeesReport {
  studentId: string;
  firstName: string;
  lastName: string;
  assignments: StudentAssignment[];
  payments: StudentPayment[];
  /** Pre-discount total — sum of baseAmount across assignments. */
  totalBase: number;
  /** Post-discount total — the real "what's owed in total". */
  totalAssigned: number;
  /** Total amount discounted across all assignments. */
  totalDiscount: number;
  totalPaid: number;
  totalDue: number;
  /** Unallocated General Credit — money paid but not yet applied to a fee. */
  totalCredit: number;
}

export interface FeesSummary {
  totalCollected: number;
  totalAssigned: number;
  totalPending: number;
  totalOverdue: number;
  todayCollection: number;
  thisMonthCollection: number;
  studentsWithDues: number;
  monthlyTrend: Array<{ month: string; collected: number }>;
}

export type PaymentRowStatus = "ACTIVE" | "REFUNDED" | "VOID";

export interface PaymentHistoryRow {
  id: string;
  receiptNumber: string | null;
  date: string;
  amount: number;
  method: PaymentMethod | null;
  notes: string | null;
  status: PaymentRowStatus;
  isRefund: boolean;
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
  q?: string;
  fromDate?: string;
  toDate?: string;
  method?: PaymentMethod;
  classId?: string;
  studentId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaymentHistoryResponse {
  rows: PaymentHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Today's-collection snapshot for the cashier workspace. */
export interface CashierSummary {
  date: string;
  collectedToday: number;
  transactionsToday: number;
  refundsToday: number;
  refundsAmountToday: number;
  byMethod: Array<{
    method: PaymentMethod | "UNKNOWN";
    amount: number;
    count: number;
  }>;
  byCashier: Array<{
    userId: string | null;
    email: string | null;
    role: string | null;
    amount: number;
    count: number;
  }>;
}

export interface DuesRow {
  studentId: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
  className: string | null;
  sectionName: string | null;
  /** Pre-discount total across the student's assignments. */
  totalBase: number;
  /** totalBase − totalAssigned. Zero when there's no scholarship. */
  totalDiscount: number;
  /** Post-discount total owed (what the student actually has to pay). */
  totalAssigned: number;
  totalPaid: number;
  totalDue: number;
  /** Unallocated General Credit balance (≥ 0). */
  totalCredit: number;
  oldestDueDate: string | null;
  overdue: boolean;
}

export interface CreateFeeStructureInput {
  name: string;
  amount: number;
  frequency: FeeFrequency;
  /** Optional — scope this fee to a specific class. */
  classId?: string | null;
}

export interface AssignFeeInput {
  feeStructureId: string;
  studentIds: string[];
  dueDate: string; // YYYY-MM-DD
  /** Optional scholarship / discount applied uniformly to every student. */
  discountType?: DiscountType;
  discountValue?: number;
}

export interface CreatePaymentInput {
  studentId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  feeAssignmentId?: string;
  method?: PaymentMethod;
  notes?: string;
  /**
   * UUID generated on the client BEFORE the first submit. Repeated
   * submissions with the same key resolve to the same Payment row on
   * the server — so a double-clicked "Save & Print" button or a
   * retried request from a flaky network never duplicates the receipt.
   */
  clientRequestId?: string;
}

export interface RefundPaymentInput {
  /** Refund amount (positive). Backend stores it as a negative payment row. */
  amount: number;
  /** Required free-form reason — recorded on the refund row for audit. */
  reason: string;
  /** Optional admin-side notes. */
  notes?: string;
}

/** Per-fee breakdown attached to receipts linked to a specific assignment. */
export interface ReceiptFeeDetail {
  baseAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  finalAmount: number;
  /** Sum of all payments against the fee, INCLUDING the one on this receipt. */
  totalPaidOnFee: number;
  /** Portion of totalPaidOnFee from DIRECT linked payments. */
  paidDirectOnFee: number;
  /** Portion of totalPaidOnFee drawn from General Credit via FIFO. */
  paidFromCreditOnFee: number;
  /** Remaining balance on the fee after this payment. */
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
  /** Null for unlinked ("general credit") payments. */
  feeDetail: ReceiptFeeDetail | null;
  school: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    /** Optional postal address — null when unset by admin. */
    address: string | null;
    /** Optional public phone — null when unset by admin. */
    phone: string | null;
  };
  /**
   * Every fee on the student's account at issue time, with paid/remaining
   * annotated. Empty for students with no assignments yet.
   */
  lineItems: ReceiptLineItem[];
  /**
   * Snapshot of the student's overall ledger at the moment this payment
   * was recorded. Stays faithful even when re-printing an old receipt.
   */
  ledger: {
    previousDue: number;
    paidNow: number;
    remainingBalance: number;
    creditBalance: number;
  };
  /** Coarse status badge — PAID_IN_FULL / PARTIAL / BALANCE_DUE. */
  status: ReceiptStatus;
  /** True when this slip is itself a refund (negative amount). */
  isRefund: boolean;
  /** Public verification URL for the QR code; null when unconfigured. */
  verificationUrl: string | null;
  /**
   * The cashier who originally recorded this payment. Surfaces on the
   * "Received by" line of the receipt slip. Null for legacy rows that
   * pre-date the audit-fields migration.
   */
  cashier: { id: string; email: string; role: string } | null;
  recordedAt: string;
}

export type ReceiptStatus = "PAID_IN_FULL" | "PARTIAL" | "BALANCE_DUE";

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

export const feesApi = {
  listStructures: () => api<FeeStructureDto[]>("/fees/structure"),
  createStructure: (input: CreateFeeStructureInput) =>
    api<FeeStructureDto>("/fees/structure", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  assign: (input: AssignFeeInput) =>
    api<{ created: number }>("/fees/assign", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getStudentFees: (studentId: string) =>
    api<StudentFeesReport>(`/fees/student/${studentId}`),
  recordPayment: (input: CreatePaymentInput) =>
    api<{
      id: string;
      amount: number;
      date: string;
      receiptNumber: string | null;
      method: PaymentMethod | null;
      notes: string | null;
    }>("/payments", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getDues: () => api<DuesRow[]>("/fees/dues"),
  getSummary: () => api<FeesSummary>("/fees/summary"),
  /**
   * Today's-collection snapshot — drives the cashier workspace stats
   * bar. Optional `date` (YYYY-MM-DD) lets admins look back; defaults
   * to today server-side.
   */
  getCashierSummary: (date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    return api<CashierSummary>(`/fees/cashier-summary${qs}`);
  },
  /**
   * Paginated, filterable payment history. Query params are
   * URL-encoded; empty fields are dropped server-side so this is
   * safe to call with all-defaults to get the most-recent N rows.
   */
  listPayments: (q: PaymentHistoryQuery = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v === undefined || v === null || v === "") continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return api<PaymentHistoryResponse>(
      qs ? `/payments?${qs}` : "/payments",
    );
  },
  getReceipt: (paymentId: string) =>
    api<Receipt>(`/payments/${encodeURIComponent(paymentId)}/receipt`),
  refundPayment: (paymentId: string, input: RefundPaymentInput) =>
    api<{
      id: string;
      amount: number;
      receiptNumber: string | null;
      refundOfPaymentId: string | null;
    }>(`/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

/** Today's date in YYYY-MM-DD (local time). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * useStudentFees — per-student fees report for the student-detail
 * page (Session 6c-detail). Returns the full StudentFeesReport with
 * dues, payments, and totals.
 *
 * Server-side authorization: `/fees/student/:id` is ADMIN-only (the
 * controller class-level @Roles(Role.ADMIN)). TEACHER + STAFF callers
 * will hit 403. The page MUST gate the call via `options.enabled =
 * isAdmin` so the cache key doesn't fill with 403 entries; the
 * surrounding section renders a "requires admin role" inline note
 * for non-admin viewers.
 *
 * Cache config: 30s staleTime — fees move on every cashier action;
 * the detail page should reflect recent collections without burning
 * RPS on every navigation.
 */
export function useStudentFees(
  studentId: string | undefined,
  options?: { enabled?: boolean },
) {
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery({
    queryKey: qk.studentFees(studentId ?? ""),
    queryFn: () => feesApi.getStudentFees(studentId as string),
    enabled:
      (options?.enabled ?? true) &&
      authReady &&
      isAuthenticated &&
      Boolean(studentId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      const status = (error as { status?: number } | null)?.status;
      // 403 = role restriction (TEACHER/STAFF caller); the page
      // renders a graceful "admin role required" message. Don't
      // retry into that wall.
      if (status === 401 || status === 403 || status === 404) return false;
      return failureCount < 1;
    },
  });
}
