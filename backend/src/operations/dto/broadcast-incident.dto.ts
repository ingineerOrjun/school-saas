import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
const SCOPES = ['ALL_SCHOOLS', 'SPECIFIC_SCHOOLS'] as const;

export class BroadcastIncidentDto {
  @IsEnum(SEVERITIES)
  severity!: (typeof SEVERITIES)[number];

  /** Operator-facing label. Matches PlatformIncident.title. */
  @IsString()
  @Length(3, 160)
  title!: string;

  /** Operator-authored body. Plain text — rendered as-is in email + in-app. */
  @IsString()
  @Length(3, 4_000)
  body!: string;

  @IsIn(SCOPES)
  targetScope!: (typeof SCOPES)[number];

  /** Required when targetScope === SPECIFIC_SCHOOLS. */
  @ValidateIf((o: BroadcastIncidentDto) => o.targetScope === 'SPECIFIC_SCHOOLS')
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  targetSchoolIds!: string[];

  @IsOptional()
  @IsString()
  @Length(0, 240)
  reason?: string;
}
