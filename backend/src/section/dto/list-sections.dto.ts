import { IsUUID } from 'class-validator';

export class ListSectionsQueryDto {
  @IsUUID()
  classId!: string;
}
