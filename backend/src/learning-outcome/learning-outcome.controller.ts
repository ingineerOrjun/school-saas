import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SubjectCode } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FeatureKey } from '../feature-flags/feature-catalog';
import { FeatureFlagsGuard } from '../feature-flags/feature-flags.guard';
import { RequireFeature } from '../feature-flags/require-feature.decorator';
import { LearningOutcomeService } from './learning-outcome.service';

// ============================================================================
// LearningOutcomeController — read-only catalogue endpoint.
//
//   GET /learning-outcomes?classLevel=4&subject=ENGLISH
//
// Auth:
//   • JwtAuthGuard — request must carry a valid Bearer token.
//   • RolesGuard   — no `@Roles()` restriction at controller level, so
//                    every authenticated user (admin, teacher, student,
//                    parent) can read. The data is platform-global
//                    reference content; tenant scope is not applied.
//   • FeatureFlagsGuard + @RequireFeature(ConEvaluation) — disabled
//                    schools get HTTP 403 with the standard
//                    "feature not enabled for your school" copy from
//                    FeatureFlagsGuard. Matches the pattern used by
//                    PromotionController + AnnouncementController.
//
// No write surfaces. No teacher-rating storage. This controller's
// scope is intentionally minimal — adding write endpoints belongs in
// a separate, reviewable session.
// ============================================================================

/**
 * Lightweight per-request query validation. We do NOT use a class-
 * validator DTO here because the query surface is two scalars; adding
 * a DTO class for two `@Query()` params is more noise than the
 * inline parsing below.
 */
function parseClassLevel(raw: unknown): number {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new BadRequestException(
      'classLevel is required. Pass it as a query parameter, e.g. ?classLevel=4.',
    );
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new BadRequestException(
      'classLevel must be an integer between 1 and 12.',
    );
  }
  return n;
}

function parseSubject(raw: unknown): SubjectCode {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new BadRequestException(
      'subject is required. Pass it as a query parameter, e.g. ?subject=ENGLISH.',
    );
  }
  // Compare against the enum value set. Prisma generates the enum as
  // an object literal — we coerce-check via inclusion in the values.
  const values = Object.values(SubjectCode) as string[];
  if (!values.includes(raw)) {
    throw new BadRequestException(
      `subject must be one of: ${values.join(', ')}.`,
    );
  }
  return raw as SubjectCode;
}

function parseOptionalUnit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') {
    throw new BadRequestException('unitNumber must be an integer.');
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException(
      'unitNumber must be a positive integer when provided.',
    );
  }
  return n;
}

@Controller('learning-outcomes')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureFlagsGuard)
@RequireFeature(FeatureKey.ConEvaluation)
export class LearningOutcomeController {
  constructor(private readonly outcomes: LearningOutcomeService) {}

  /**
   * GET /learning-outcomes?classLevel=<n>&subject=<SubjectCode>
   *
   * Optional:
   *   • curriculumVersion=<BS-year>  (defaults to "2083")
   *   • unitNumber=<n>               (filter to one unit)
   *
   * Returns: ordered array of LearningOutcome rows. Empty array when
   * the (classLevel, subject) pair has no seeded outcomes yet — this
   * is a normal "not seeded" state, NOT a 404.
   */
  @Get()
  async list(
    @Query('classLevel') classLevel?: string,
    @Query('subject') subject?: string,
    @Query('curriculumVersion') curriculumVersion?: string,
    @Query('unitNumber') unitNumber?: string,
  ) {
    return this.outcomes.list({
      classLevel: parseClassLevel(classLevel),
      subjectCode: parseSubject(subject),
      curriculumVersion:
        typeof curriculumVersion === 'string' && curriculumVersion.length > 0
          ? curriculumVersion
          : undefined,
      unitNumber: parseOptionalUnit(unitNumber),
    });
  }
}
