import { Module, forwardRef } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { StudentRegistrationNumberService } from './services/student-registration-number.service';

@Module({
  // PlatformModule exports PlatformAuditService — used by StudentService
  // to emit STUDENT_ARCHIVED / STUDENT_RESTORED audit rows when an
  // admin soft-deletes / restores a student. forwardRef matches the
  // ExamsModule pattern in case PlatformModule grows a back-import.
  imports: [forwardRef(() => PlatformModule)],
  controllers: [StudentController],
  providers: [StudentService, StudentRegistrationNumberService],
  exports: [StudentService, StudentRegistrationNumberService],
})
export class StudentModule {}
