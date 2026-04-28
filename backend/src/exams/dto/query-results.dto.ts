import { IsUUID } from 'class-validator';

export class QueryResultsDto {
  @IsUUID()
  examId!: string;

  @IsUUID()
  studentId!: string;
}
