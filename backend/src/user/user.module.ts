import { Module, forwardRef } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  // PlatformModule exports PlatformAuditService — used by UserService
  // to emit USER_DEACTIVATED audit rows when a user is soft-deleted
  // (Session 6c.1). forwardRef matches the StudentModule pattern in
  // case PlatformModule grows a back-import.
  imports: [forwardRef(() => PlatformModule)],
  controllers: [UserController],
  providers: [UserService],
  // Session 6c.3 follow-up — UserService must be exported so
  // TeacherModule (and any future caller) can inject it for the
  // soft-delete delegation path. Without this `exports` line, an
  // `imports: [UserModule]` consumer resolves the module but cannot
  // see any of its providers, producing the
  // UnknownDependenciesException that broke boot. Pinned by the
  // `src/__tests__/module-boot.spec.ts` smoke test — removing this
  // line again will fail that test before runtime catches it.
  exports: [UserService],
})
export class UserModule {}
