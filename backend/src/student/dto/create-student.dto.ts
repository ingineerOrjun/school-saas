import { Gender } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Phone format: exactly 10 numeric digits, no spaces/dashes/symbols.
 * Tight on purpose — keeps "abc123" and "98-7654-3210" out of the DB.
 * Tweak if you ever support international numbers explicitly.
 */
const CONTACT_NUMBER_RE = /^[0-9]{10}$/;
const CONTACT_NUMBER_MSG =
  'contactNumber must be exactly 10 digits (numbers only).';

export class CreateStudentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  /**
   * Nepal-style Symbol / Roll number. Unique within a school when present.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  symbolNumber?: string | null;

  // ------------------------------------------------------------------
  // Demographic + contact essentials (all required by the school spec)
  // ------------------------------------------------------------------

  @IsEnum(Gender)
  gender!: Gender;

  /** ISO date YYYY-MM-DD (or full ISO 8601). */
  @IsDateString()
  dateOfBirth!: string;

  @IsString()
  @MinLength(1, { message: 'parentName must not be empty' })
  @MaxLength(120)
  parentName!: string;

  @IsString()
  @Matches(CONTACT_NUMBER_RE, { message: CONTACT_NUMBER_MSG })
  contactNumber!: string;

  // ------------------------------------------------------------------
  // Optional fields
  // ------------------------------------------------------------------

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsDateString()
  admissionDate?: string | null;

  /**
   * Optionally link the student to an existing User account. The service
   * verifies the user belongs to the same school.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /**
   * Optional class scope. When set, only students in that class may have
   * this fee assigned to them. Leave null for a school-wide fee.
   */
  @IsOptional()
  @IsUUID()
  classId?: string | null;

  @IsOptional()
  @IsUUID()
  sectionId?: string | null;
}
