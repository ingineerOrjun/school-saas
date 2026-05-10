import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JobRegistry } from '../common/jobs/job-registry.service';
import { HashingModule } from '../common/hashing/hashing.module';
import { DatabaseModule } from '../database/database.module';
import { AnnouncementService } from './announcement.service';
import { BrandConfigService } from './brand-config.service';
import { DeploymentService } from './deployment.service';
import { ExportRunHandler } from './export-run.handler';
import { ExportService } from './export.service';
import { GuardianService } from './guardian.service';
import { ImportService } from './import.service';
import { InvitationService } from './invitation.service';
import { OnboardingService } from './onboarding.service';
import { PlatformProductizationController } from './platform-productization.controller';
import { SchoolProductizationController } from './school-onboarding.controller';
import { StudentModule } from '../student/student.module';
import { SupportNoteService } from './support-note.service';

// ---------------------------------------------------------------------------
// ProductizationModule — Phase 23.
//
// All commercial-readiness surfaces in one module. Uses the existing
// global services (NotificationService, JobQueueService, JobRegistry,
// HashingService) — no further imports beyond DatabaseModule +
// ConfigModule + HashingModule.
//
// onModuleInit:
//   Registers the ExportRunHandler with JobRegistry so the runner
//   picks up `export.run` jobs. Same pattern PlatformModule uses
//   for its own handlers.
// ---------------------------------------------------------------------------

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    HashingModule,
    // ImportService injects StudentRegistrationNumberService for the
    // bulk-students-CSV path (every imported student needs a permanent
    // registration number generated alongside the row).
    StudentModule,
  ],
  controllers: [
    SchoolProductizationController,
    PlatformProductizationController,
  ],
  providers: [
    OnboardingService,
    InvitationService,
    BrandConfigService,
    SupportNoteService,
    AnnouncementService,
    GuardianService,
    ExportService,
    ExportRunHandler,
    ImportService,
    DeploymentService,
  ],
  exports: [
    OnboardingService,
    InvitationService,
    BrandConfigService,
    AnnouncementService,
    DeploymentService,
  ],
})
export class ProductizationModule implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly exportHandler: ExportRunHandler,
  ) {}

  onModuleInit() {
    this.registry.register(this.exportHandler);
  }
}
