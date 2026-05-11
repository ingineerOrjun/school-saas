import { Module, forwardRef } from '@nestjs/common';
import { GradingModule } from '../grading/grading.module';
import { PlatformModule } from '../platform/platform.module';
import { ExamsController } from './exams.controller';
import { ExamService } from './exam.service';
import { ResultService } from './result.service';
import { SubjectService } from './subject.service';

@Module({
  // PlatformModule exports PlatformAuditService — used by ExamService
  // to emit MARKS_LOCKED / MARKS_UNLOCKED audit rows when an admin
  // toggles the exam-level publication lock.
  imports: [GradingModule, forwardRef(() => PlatformModule)],
  controllers: [ExamsController],
  providers: [ExamService, SubjectService, ResultService],
  exports: [ExamService, SubjectService, ResultService],
})
export class ExamsModule {}
