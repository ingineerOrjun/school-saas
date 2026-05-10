import { Module } from '@nestjs/common';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { StudentRegistrationNumberService } from './services/student-registration-number.service';

@Module({
  controllers: [StudentController],
  providers: [StudentService, StudentRegistrationNumberService],
  exports: [StudentService, StudentRegistrationNumberService],
})
export class StudentModule {}
