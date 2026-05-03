import { IsOptional, IsUUID } from 'class-validator';

/**
 * Payload for `POST /teachers/:teacherId/assignments`. The teacher id
 * comes from the URL, so the body only carries the (class, optional
 * section, optional subject) tuple.
 */
export class CreateTeachingAssignmentDto {
  @IsUUID()
  classId!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string | null;

  @IsOptional()
  @IsUUID()
  subjectId?: string | null;
}
