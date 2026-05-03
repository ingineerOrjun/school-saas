import { api } from "./api";

export type FeeFrequency = "MONTHLY" | "ONE_TIME";
export type AssignmentStatus = "PAID" | "PARTIAL" | "UNPAID";
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
  school: { id: string; name: string; slug: string; logoUrl: string | null };
  recordedAt: string;
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
  getReceipt: (paymentId: string) =>
    api<Receipt>(`/payments/${encodeURIComponent(paymentId)}/receipt`),
};

/** Today's date in YYYY-MM-DD (local time). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
