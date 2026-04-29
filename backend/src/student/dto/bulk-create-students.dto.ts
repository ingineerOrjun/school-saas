import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
} from 'class-validator';
import { Gender } from '@prisma/client';

/** Hard cap so a runaway upload can't exhaust memory. */
const BULK_MAX = 500;

/**
 * Plain TypeScript type for one row in a bulk-import payload — used for
 * typing only. We intentionally do NOT decorate this with class-validator
 * rules: per-row validation runs inside the service so a single bad row
 * doesn't reject the whole batch (the spec calls for partial success).
 */
export interface BulkStudentInput {
  firstName: string;
  lastName: string;
  symbolNumber?: string | null;
  gender: Gender;
  dateOfBirth: string;
  parentName: string;
  contactNumber: string;
  address?: string | null;
  admissionDate?: string | null;
  className?: string | null;
}

/**
 * Outer shape only is validated here:
 *   • `students` exists, is an array, has between 1 and BULK_MAX entries.
 * Inner row validation happens in `StudentService.bulkCreate()` where
 * we can collect failures alongside successes.
 */
export class BulkCreateStudentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  students!: unknown[];
}
