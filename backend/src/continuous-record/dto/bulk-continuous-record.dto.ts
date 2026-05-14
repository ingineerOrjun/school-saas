import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateContinuousRecordDto } from './create-continuous-record.dto';

// ============================================================================
// BulkContinuousRecordDto
//
// Payload for POST /continuous-records/bulk. A flat array of single-
// rating DTOs, capped at 200 entries. One student × one subject in
// Class 4-5 produces ~10–15 indicators; 200 covers the largest
// realistic write (an entire class section × a whole subject) with
// plenty of headroom, while still rejecting outright abuse.
//
// Validation runs at the DTO layer (class-validator pipeline) BEFORE
// the controller method body executes. Field-level errors come back
// as 400 with the standard Nest validation envelope. Cross-record
// invariants (duplicate composite keys, AFTER_SUPPORT preconditions,
// teacher scope) are enforced by the service layer.
// ============================================================================
export class BulkContinuousRecordDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateContinuousRecordDto)
  records!: CreateContinuousRecordDto[];
}
