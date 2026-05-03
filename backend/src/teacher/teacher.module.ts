import { Module } from '@nestjs/common';
import { HashingModule } from '../common/hashing/hashing.module';
import { TeacherController } from './teacher.controller';
import { TeacherService } from './teacher.service';

@Module({
  // HashingModule provides HashingService — needed by createWithUser to
  // bcrypt the teacher's password before persisting the User row.
  imports: [HashingModule],
  controllers: [TeacherController],
  providers: [TeacherService],
  exports: [TeacherService],
})
export class TeacherModule {}
