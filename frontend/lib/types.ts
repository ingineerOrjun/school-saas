export type Trend = "up" | "down";

export interface DashboardStats {
  totalStudents: number;
  totalTeachers: number;
  attendanceTodayPct: number;
  feesCollected: number;
  /** School-wide General Credit (raw sum of unlinked payments). */
  totalCredit: number;
  studentsDelta: number;
  teachersDelta: number;
  attendanceDelta: number;
  feesDelta: number;
}

export type StudentStatus = "Active" | "On Leave";
export type FeeStatus = "Paid" | "Pending" | "Overdue";

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  section: string;
  status: StudentStatus;
  fees: FeeStatus;
}

export interface DashboardData {
  stats: DashboardStats;
  recentStudents: Student[];
}
