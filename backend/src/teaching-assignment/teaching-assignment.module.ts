import { Module } from '@nestjs/common';
import { TeachingAssignmentController } from './teaching-assignment.controller';
import { TeachingAssignmentService } from './teaching-assignment.service';

@Module({
  controllers: [TeachingAssignmentController],
  providers: [TeachingAssignmentService],
  exports: [TeachingAssignmentService],
})
export class TeachingAssignmentModule {}
