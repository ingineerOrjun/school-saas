import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/**
 * One (class, optional section, optional subject) tuple. Used as both
 * an "add" and a "remove" entry in the bulk payload — the diff the
 * client computed against the server state.
 *
 * NOTE: the assignment row id is intentionally NOT in the payload.
 * Removes are addressed by tuple match so the client never needs to
 * track ids; it just sends "the cells you ticked" and "the cells you
 * unticked".
 */
export class BulkAssignmentTupleDto {
  @IsUUID()
  classId!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string | null;

  @IsOptional()
  @IsUUID()
  subjectId?: string | null;
}

/**
 * Payload for `POST /teachers/:teacherId/assignments/bulk`. The
 * teacher id comes from the URL.
 *
 * Both lists are bounded to keep a single request from blowing up the
 * transaction. A teacher with 200 assignments would be a data-modeling
 * bug — the cap is generous but cheap insurance.
 */
export class BulkTeachingAssignmentsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkAssignmentTupleDto)
  add!: BulkAssignmentTupleDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkAssignmentTupleDto)
  remove!: BulkAssignmentTupleDto[];
}
