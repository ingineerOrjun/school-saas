import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { FeatureKey } from '../feature-flags/feature-catalog';
import { FeatureFlagsGuard } from '../feature-flags/feature-flags.guard';
import { RequireFeature } from '../feature-flags/require-feature.decorator';
import { ContinuousRecordService } from './continuous-record.service';
import { BulkContinuousRecordDto } from './dto/bulk-continuous-record.dto';
import { CreateContinuousRecordDto } from './dto/create-continuous-record.dto';
import { ListContinuousRecordDto } from './dto/list-continuous-record.dto';

// ============================================================================
// ContinuousRecordController — CDC continuous-evaluation write surface.
//
// Three endpoints, all gated identically:
//   • POST /continuous-records       — single upsert
//   • POST /continuous-records/bulk  — atomic bulk upsert
//   • GET  /continuous-records       — list by (student, session)
//
// Guard stack (same order used by PromotionController and the read-only
// LearningOutcomeController, so the exception filter reaches a known
// failure shape):
//   1. JwtAuthGuard       — 401 without a valid Bearer token.
//   2. RolesGuard         — 403 if the caller's role is not in @Roles.
//   3. FeatureFlagsGuard  — 403 with the standard feature-disabled
//                            copy when conEvaluation is off for the
//                            caller's school.
//
// Roles allowed:
//   • TEACHER     — primary writer; per-call scope refined by
//                    TeacherScopeService.assertContinuousRecordAccess.
//   • STAFF       — school-wide academic ops; bypasses the per-class
//                    scope check.
//   • ADMIN       — full bypass.
//   • SUPER_ADMIN — read-only here for cross-school inspection (writes
//                    pass through too but the service enforces tenant
//                    on the student record).
//
// Why no STUDENT / PARENT roles: continuous-evaluation reads are NOT a
// student-facing surface yet — they're operator state for the report
// card. A separate student/parent endpoint will land alongside the
// report-card feature.
// ============================================================================

@Controller('continuous-records')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureFlagsGuard)
@RequireFeature(FeatureKey.ConEvaluation)
export class ContinuousRecordController {
  constructor(private readonly records: ContinuousRecordService) {}

  /**
   * POST /continuous-records
   *
   * Single-record upsert. Returns the saved row.
   *
   * • First successful insert → 201 Created.
   * • Subsequent updates to the same composite key also return 201 by
   *   default (Nest's POST). That's intentional — the route is an
   *   UPSERT, not a strict POST; callers should not branch on the
   *   2xx status to distinguish create vs update. (The frontend
   *   uses the `updatedAt` round-trip + history list to know.)
   */
  @Post()
  @Roles(Role.TEACHER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN)
  upsert(
    @Body() dto: CreateContinuousRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.records.upsertSingle(dto, user);
  }

  /**
   * POST /continuous-records/bulk
   *
   * Atomic bulk upsert. Either every row in the payload writes, or
   * none do. Returns the saved rows in the same order as the input.
   *
   * Failure modes (in order they're checked):
   *   • 400 — duplicate composite keys inside the payload, or any
   *           class-validator pipeline failure.
   *   • 400 — locked session referenced by any input.
   *   • 403 — teacher scope fails for any input.
   *   • 422 — AFTER_SUPPORT precondition fails for any input.
   *   • 409 — optimistic-concurrency mismatch on any input
   *           (CONCURRENT_MODIFICATION).
   *
   * Returns 200 OK (not 201) — the response represents the post-write
   * state, and the route accepts existing rows for update. The single
   * endpoint above uses Nest's default 201 to match the "create-or-
   * update" contract teachers expect from a single rating action.
   */
  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.TEACHER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN)
  upsertBulk(
    @Body() dto: BulkContinuousRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.records.upsertBulk(dto.records, user);
  }

  /**
   * GET /continuous-records?studentId=…&sessionId=…[&subjectCode=…&classLevel=…]
   *
   * Returns the rows for that student in that session, optionally
   * narrowed by subject + class level. Ordered by
   *   outcome.unitNumber, outcome.sortOrder, phase
   * so the report-card UI can render straight from the array without
   * a second sort pass.
   *
   * Tenant: enforced by the service. TEACHER must be in scope for the
   * requested student; ADMIN + STAFF + SUPER_ADMIN bypass the
   * per-assignment check (SUPER_ADMIN also bypasses the school filter).
   */
  @Get()
  @Roles(Role.TEACHER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN)
  list(
    @Query() query: ListContinuousRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.records.list(query, user);
  }
}
