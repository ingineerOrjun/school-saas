import { Global, Module } from '@nestjs/common';
import { TeacherScopeService } from './teacher-scope.service';

/**
 * Global so any feature module can inject TeacherScopeService without
 * having to import another module — role-scoping is cross-cutting.
 */
@Global()
@Module({
  providers: [TeacherScopeService],
  exports: [TeacherScopeService],
})
export class TeacherScopeModule {}
