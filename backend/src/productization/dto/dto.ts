import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsHexColor,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '@prisma/client';

// ---------------------------------------------------------------------------
// Productization DTOs (Phase 23). All in one file because each is
// tiny and they're all consumed by the same controller layer.
// ---------------------------------------------------------------------------

// Section 1 — Onboarding
export class SetOnboardingStepDto {
  @IsString()
  @IsIn(['school-profile', 'academic-setup', 'staff-setup', 'fee-setup', 'complete'])
  step!: string;
}

// Section 2 — Invitations
export class CreateInvitationDto {
  @IsString()
  @Length(3, 180)
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  displayName?: string;
}

export class AcceptInvitationDto {
  @IsString()
  @Length(1, 80)
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  displayName?: string;
}

// Section 3 — Branding
export class UpdateBrandingDto {
  @IsOptional()
  @IsHexColor()
  brandPrimaryColor?: string | null;

  @IsOptional()
  @IsHexColor()
  brandAccentColor?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 160)
  brandSlogan?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  brandReceiptFooter?: string | null;
}

// Section 6 — Support notes
export class CreateSupportNoteDto {
  @IsString()
  @Length(1, 4_000)
  body!: string;

  @IsOptional()
  @IsString()
  @IsIn(['important', 'info', 'warning'])
  tone?: string;
}

// Section 7 — Announcements
const AUDIENCES = ['ALL_SCHOOLS', 'ADMINS_ONLY', 'TEACHERS_ONLY', 'SPECIFIC_SCHOOLS'] as const;
export class PublishAnnouncementDto {
  @IsString()
  @Length(3, 180)
  title!: string;

  @IsString()
  @Length(3, 4_000)
  body!: string;

  @IsOptional()
  @IsString()
  @IsIn(['info', 'success', 'warning'])
  tone?: string;

  @IsIn(AUDIENCES)
  audience!: (typeof AUDIENCES)[number];

  @ValidateIf((o: PublishAnnouncementDto) => o.audience === 'SPECIFIC_SCHOOLS')
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  targetSchoolIds!: string[];

  @IsOptional()
  @IsString()
  @Length(0, 500)
  linkUrl?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

// Section 12 — Guardians
export class CreateGuardianDto {
  @IsString()
  @Length(1, 180)
  fullName!: string;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  relationship?: string;

  @IsOptional()
  @IsString()
  @Length(0, 4_000)
  notes?: string;
}

export class UpdateGuardianDto {
  @IsOptional() @IsString() @Length(0, 180) fullName?: string;
  @IsOptional() @IsString() @Length(0, 180) email?: string | null;
  @IsOptional() @IsString() @Length(0, 40) phone?: string | null;
  @IsOptional() @IsString() @Length(0, 40) relationship?: string | null;
  @IsOptional() @IsString() @Length(0, 4_000) notes?: string | null;
}

export class LinkGuardianDto {
  @IsUUID('4')
  studentId!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  relationship?: string;
}

// Section 8 — Exports
export class CreateExportDto {
  @IsString()
  @IsIn(['students', 'fees', 'attendance', 'results', 'audit'])
  entity!: 'students' | 'fees' | 'attendance' | 'results' | 'audit';

  @IsString()
  @IsIn(['csv', 'xlsx', 'pdf'])
  format!: 'csv' | 'xlsx' | 'pdf';
}

// Section 9 — Imports
export class DryRunImportDto {
  @IsString()
  @IsIn(['students', 'teachers', 'fee_structures'])
  entity!: 'students' | 'teachers' | 'fee_structures';

  @IsString()
  @Length(1, 240)
  filename!: string;

  /** Inlined CSV body. UI uploads via multipart in real life;
   *  for the v1 endpoint we accept the body as a JSON string field. */
  @IsString()
  csv!: string;
}
