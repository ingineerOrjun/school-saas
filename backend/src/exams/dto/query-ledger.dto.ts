import { IsUUID } from 'class-validator';

/**
 * Query for the class-wide grade ledger:
 *   GET /results/ledger?examId=...&classId=...
 *
 * Both fields are required — the response includes one row per student
 * in the class, with one cell per subject in the exam.
 */
export class QueryLedgerDto {
  @IsUUID()
  examId!: string;

  @IsUUID()
  classId!: string;
}
