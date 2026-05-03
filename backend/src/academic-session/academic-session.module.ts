import { Global, Module } from '@nestjs/common';
import { AcademicSessionController } from './academic-session.controller';
import { AcademicSessionService } from './academic-session.service';

/**
 * Global so other feature modules (Attendance, Exams, Result,
 * Announcement) can inject `AcademicSessionService` without each
 * adding it to their imports list. Same pattern we used for
 * `TeacherScopeModule`.
 */
@Global()
@Module({
  controllers: [AcademicSessionController],
  providers: [AcademicSessionService],
  exports: [AcademicSessionService],
})
export class AcademicSessionModule {}
