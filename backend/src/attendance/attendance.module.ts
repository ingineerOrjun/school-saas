import { Module, forwardRef } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  // PlatformModule exports PlatformAuditService — used by
  // AttendanceService to emit ATTENDANCE_BULK_OVERWRITE rows when a
  // single mark() call writes >= 5 students at once (mark-all-present
  // / mark-all-absent flows).
  imports: [forwardRef(() => PlatformModule)],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
