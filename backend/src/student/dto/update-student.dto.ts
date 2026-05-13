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

/** Mirror the Create DTO — see create-student.dto.ts for rationale. */
const CONTACT_NUMBER_RE = /^[0-9]{10}$/;
const CONTACT_NUMBER_MSG =
  'contactNumber must be exactly 10 digits (numbers only).';

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  symbolNumber?: string | null;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'parentName must not be empty' })
  @MaxLength(120)
  parentName?: string;

  @IsOptional()
  @IsString()
  @Matches(CONTACT_NUMBER_RE, { message: CONTACT_NUMBER_MSG })
  contactNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsDateString()
  admissionDate?: string | null;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string | null;

  @IsOptional()
  @IsUUID()
  sectionId?: string | null;

  /**
   * Phase FINAL-HARDENING Part 2: optimistic-concurrency stamp the
   * client round-trips from the GET. The service-layer
   * `assertNotStaleAndUpdate` uses this to reject a write whose
   * row has moved since the client loaded it. Optional during the
   * rollout window — clients that omit it fall back to last-write-
   * wins. New clients SHOULD include it.
   */
  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}
