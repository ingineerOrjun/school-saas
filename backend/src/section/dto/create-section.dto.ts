import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsUUID()
  classId!: string;
}
