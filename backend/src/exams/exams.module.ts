import { Module } from '@nestjs/common';
import { GradingModule } from '../grading/grading.module';
import { ExamsController } from './exams.controller';
import { ExamService } from './exam.service';
import { ResultService } from './result.service';
import { SubjectService } from './subject.service';

@Module({
  imports: [GradingModule],
  controllers: [ExamsController],
  providers: [ExamService, SubjectService, ResultService],
  exports: [ExamService, SubjectService, ResultService],
})
export class ExamsModule {}
