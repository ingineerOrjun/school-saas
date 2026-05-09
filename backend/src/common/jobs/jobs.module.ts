import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { JobQueueService } from './job-queue.service';
import { JobRegistry } from './job-registry.service';
import { JobRunnerService } from './job-runner.service';

// ---------------------------------------------------------------------------
// JobsModule — Phase 15.
//
// @Global() so any feature module can inject `JobQueueService` to
// schedule work + `JobRegistry` to register a handler at boot. The
// runner is wired internally and starts polling at OnApplicationBootstrap.
//
// Wiring pattern for handler-owning modules:
//
//   @Module({
//     providers: [SendDeliveryHandler, MyService],
//   })
//   export class MyModule implements OnModuleInit {
//     constructor(
//       private readonly registry: JobRegistry,
//       private readonly handler: SendDeliveryHandler,
//     ) {}
//     onModuleInit() {
//       this.registry.register(this.handler);
//     }
//   }
//
// Handlers are plain @Injectable classes implementing JobHandler;
// the module's onModuleInit registers them. We intentionally don't
// auto-discover via decorators — explicit registration is greppable.
// ---------------------------------------------------------------------------

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [JobQueueService, JobRegistry, JobRunnerService],
  exports: [JobQueueService, JobRegistry],
})
export class JobsModule {}
