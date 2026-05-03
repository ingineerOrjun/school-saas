import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  // Aligns with the Prisma schema's VARCHAR(160) cap.
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(1)
  // 5 KB ceiling — generous enough for multi-paragraph notices,
  // tight enough that a single posting can't blow up the feed.
  @MaxLength(5000)
  message!: string;
}
