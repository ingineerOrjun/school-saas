import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// OnboardingService — Phase 23 Section 1.
//
// Tracks the school's first-run wizard state. The wizard has five
// steps; the column `School.onboardingStep` carries the slug of the
// step the school is currently on (or "complete" once finished).
// `School.onboardingCompleted` is the simple "shown the wizard?"
// flag the dashboard shell consults to decide whether to redirect
// new tenants into /onboarding.
//
// Wizard steps (slugs):
//
//   school-profile  → ask for name / logo / address / phone /
//                     principal name. Saved via PATCH /school.
//   academic-setup  → at least one academic session + one class.
//   staff-setup     → at least one teacher invitation sent.
//   fee-setup       → at least one fee structure created.
//   complete        → terminal. Dashboard shell stops redirecting.
//
// The wizard is RESUMABLE — every step persists to the existing
// domain tables, then bumps `onboardingStep`. The frontend reads
// `getStatus()` on /onboarding mount and resumes from the saved
// step. Operators can `skip()` to mark complete without finishing.
//
// "Completion %" derivation:
//   We score each step as done/not-done by querying the relevant
//   domain table — no separate progress row to drift. So even if
//   the operator manually creates a teacher in admin without
//   touching the wizard, the % bumps up.
// ---------------------------------------------------------------------------

const STEP_SLUGS = [
  'school-profile',
  'academic-setup',
  'staff-setup',
  'fee-setup',
  'complete',
] as const;

export type OnboardingStep = (typeof STEP_SLUGS)[number];

export interface OnboardingStepStatus {
  slug: OnboardingStep;
  /** True when the step's completion criterion is satisfied. */
  done: boolean;
  /** Operator-readable summary: "2 classes, 3 sections" etc. */
  detail: string;
}

export interface OnboardingStatus {
  schoolId: string;
  /** The step the wizard currently parks on. */
  currentStep: OnboardingStep;
  /** True when the wizard was completed or explicitly skipped. */
  completed: boolean;
  /** 0..100 — fraction of completable steps satisfied. */
  completionPct: number;
  /** Per-step breakdown for the UI checklist. */
  steps: OnboardingStepStatus[];
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStatus(schoolId: string): Promise<OnboardingStatus> {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        address: true,
        phone: true,
        onboardingCompleted: true,
        onboardingStep: true,
      },
    });

    const [academicSessionsCount, classesCount, teachersCount, invitationsCount, feeStructuresCount] =
      await Promise.all([
        this.prisma.academicSession.count({ where: { schoolId } }),
        this.prisma.class.count({ where: { schoolId } }),
        this.prisma.teacher.count({ where: { schoolId } }),
        this.prisma.userInvitation.count({
          where: { schoolId, acceptedAt: null, revokedAt: null },
        }),
        this.prisma.feeStructure.count({ where: { schoolId } }),
      ]);

    const profileDone =
      !!school.logoUrl &&
      !!school.address &&
      !!school.phone &&
      school.name.trim().length > 0;

    const steps: OnboardingStepStatus[] = [
      {
        slug: 'school-profile',
        done: profileDone,
        detail: profileDone
          ? 'Name, logo, address, and phone are set'
          : 'Add logo, address, and phone',
      },
      {
        slug: 'academic-setup',
        done: academicSessionsCount > 0 && classesCount > 0,
        detail: `${academicSessionsCount} academic session(s) · ${classesCount} class(es)`,
      },
      {
        slug: 'staff-setup',
        done: teachersCount > 0 || invitationsCount > 0,
        detail:
          teachersCount > 0
            ? `${teachersCount} teacher(s) on the roster`
            : invitationsCount > 0
              ? `${invitationsCount} invitation(s) outstanding`
              : 'Invite at least one teacher',
      },
      {
        slug: 'fee-setup',
        done: feeStructuresCount > 0,
        detail:
          feeStructuresCount > 0
            ? `${feeStructuresCount} fee structure(s) defined`
            : 'Create at least one fee structure',
      },
      {
        slug: 'complete',
        done: school.onboardingCompleted,
        detail: school.onboardingCompleted
          ? 'Wizard finished'
          : 'Mark onboarding complete to launch',
      },
    ];

    // Completion % over the four real steps (excluding the
    // terminal "complete" pseudo-step which is its own decision).
    const realSteps = steps.slice(0, 4);
    const doneCount = realSteps.filter((s) => s.done).length;
    const completionPct = Math.round((doneCount / realSteps.length) * 100);

    return {
      schoolId,
      currentStep: (school.onboardingStep as OnboardingStep) ?? 'school-profile',
      completed: school.onboardingCompleted,
      completionPct,
      steps,
    };
  }

  /**
   * Operator advances the wizard to a specific step. Resumable —
   * the frontend calls this when the user clicks "next" / "back"
   * so a refresh restores where they were.
   */
  async setStep(schoolId: string, step: OnboardingStep): Promise<OnboardingStatus> {
    if (!STEP_SLUGS.includes(step)) {
      throw new BadRequestException(`Unknown onboarding step: "${step}".`);
    }
    await this.prisma.school.update({
      where: { id: schoolId },
      data: { onboardingStep: step },
    });
    return this.getStatus(schoolId);
  }

  /**
   * Mark the wizard complete. Idempotent. Operators can also "skip"
   * (same call); the wizard never strictly enforces every step is
   * done — it's a guide, not a gate.
   */
  async complete(schoolId: string): Promise<OnboardingStatus> {
    await this.prisma.school.update({
      where: { id: schoolId },
      data: { onboardingCompleted: true, onboardingStep: 'complete' },
    });
    this.logger.log(`[onboarding] school=${schoolId} marked complete`);
    return this.getStatus(schoolId);
  }

  /**
   * Reset — operator wants to re-run the wizard. SUPER_ADMIN-only at
   * the controller layer; not exposed to school admins.
   */
  async reset(schoolId: string): Promise<OnboardingStatus> {
    await this.prisma.school.update({
      where: { id: schoolId },
      data: { onboardingCompleted: false, onboardingStep: 'school-profile' },
    });
    return this.getStatus(schoolId);
  }
}
