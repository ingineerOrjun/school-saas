import { Module } from '@nestjs/common';
import { HashingModule } from '../common/hashing/hashing.module';
import { UserModule } from '../user/user.module';
import { TeacherController } from './teacher.controller';
import { TeacherService } from './teacher.service';

@Module({
  // HashingModule provides HashingService — needed by createWithUser to
  // bcrypt the teacher's password before persisting the User row.
  //
  // UserModule provides UserService — Session 6c.3 routes teacher
  // deletion through `userService.softDelete()` (the same path the
  // user-delete endpoint uses), inheriting its authorization +
  // active-assignment refusal + audit emit. No `forwardRef` needed:
  // the dependency graph TeacherModule → UserModule → PlatformModule
  // terminates with no back-edge into TeacherModule (verified
  // 6c.3-followup). If a future change introduces a real cycle,
  // wrap in `forwardRef(() => UserModule)` then.
  imports: [HashingModule, UserModule],
  controllers: [TeacherController],
  providers: [TeacherService],
  exports: [TeacherService],
})
export class TeacherModule {}
