import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * @deprecated The bare `POST /teachers` endpoint is now disabled —
 * every teacher MUST be created with a linked User account so they
 * can sign in. Use `CreateTeacherWithUserDto` (POST /teachers/
 * create-with-user) instead. This DTO is kept only so the legacy
 * route returns a clean validation message before the service throws
 * the "use createWithUser" 400.
 */
export class CreateTeacherDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
