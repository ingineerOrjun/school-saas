import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;
}
